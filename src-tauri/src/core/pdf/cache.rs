use std::num::NonZeroUsize;
use std::sync::Mutex;
use lru::LruCache;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PageCacheKey {
    pub doc_id: String,
    pub page_number: u32,
    pub scale_int: u32, // scale * 100 as integer to avoid floating point hash issues
}

struct CacheInner {
    lru: LruCache<PageCacheKey, Vec<u8>>,
    current_bytes: usize,
}

pub struct PageCache {
    inner: Mutex<CacheInner>,
    max_bytes: usize,
}

impl PageCache {
    pub const DEFAULT_MAX_BYTES: usize = 128 * 1024 * 1024; // 128 MB memory budget

    pub fn new(capacity: usize) -> Self {
        Self::new_with_max_bytes(capacity, Self::DEFAULT_MAX_BYTES)
    }

    pub fn new_with_max_bytes(capacity: usize, max_bytes: usize) -> Self {
        let cap = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(16).unwrap());
        Self {
            inner: Mutex::new(CacheInner {
                lru: LruCache::new(cap),
                current_bytes: 0,
            }),
            max_bytes,
        }
    }

    pub fn get(&self, doc_id: &str, page_number: u32, scale: f32) -> Option<Vec<u8>> {
        let key = PageCacheKey {
            doc_id: doc_id.to_string(),
            page_number,
            scale_int: (scale * 100.0).round() as u32,
        };
        let mut state = self.inner.lock().ok()?;
        state.lru.get(&key).cloned()
    }

    pub fn insert(&self, doc_id: &str, page_number: u32, scale: f32, data: Vec<u8>) {
        let key = PageCacheKey {
            doc_id: doc_id.to_string(),
            page_number,
            scale_int: (scale * 100.0).round() as u32,
        };
        let data_len = data.len();
        if let Ok(mut state) = self.inner.lock() {
            // Deduct old value if key already present
            if let Some(old) = state.lru.pop(&key) {
                state.current_bytes = state.current_bytes.saturating_sub(old.len());
            }

            // Evict LRU items while over byte budget
            while state.current_bytes + data_len > self.max_bytes && !state.lru.is_empty() {
                if let Some((_, evicted)) = state.lru.pop_lru() {
                    state.current_bytes = state.current_bytes.saturating_sub(evicted.len());
                } else {
                    break;
                }
            }

            // Evict LRU items while over item capacity count
            while state.lru.len() >= state.lru.cap().get() && !state.lru.is_empty() {
                if let Some((_, evicted)) = state.lru.pop_lru() {
                    state.current_bytes = state.current_bytes.saturating_sub(evicted.len());
                } else {
                    break;
                }
            }

            state.lru.put(key, data);
            state.current_bytes += data_len;
        }
    }

    pub fn current_bytes(&self) -> usize {
        self.inner.lock().map(|s| s.current_bytes).unwrap_or(0)
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    pub fn clear_doc(&self, doc_id: &str) {
        if let Ok(mut state) = self.inner.lock() {
            let keys_to_remove: Vec<PageCacheKey> = state
                .lru
                .iter()
                .filter(|(k, _)| k.doc_id == doc_id)
                .map(|(k, _)| k.clone())
                .collect();
            for k in keys_to_remove {
                if let Some(val) = state.lru.pop(&k) {
                    state.current_bytes = state.current_bytes.saturating_sub(val.len());
                }
            }
        }
    }

    pub fn clear_all(&self) {
        if let Ok(mut state) = self.inner.lock() {
            state.lru.clear();
            state.current_bytes = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bounded_lru_cache() {
        let cache = PageCache::new(3);

        cache.insert("doc1", 1, 1.0, vec![1, 2, 3]);
        cache.insert("doc1", 2, 1.0, vec![4, 5, 6]);
        cache.insert("doc1", 3, 1.0, vec![7, 8, 9]);

        assert_eq!(cache.get("doc1", 1, 1.0), Some(vec![1, 2, 3]));
        assert_eq!(cache.get("doc1", 2, 1.0), Some(vec![4, 5, 6]));

        // Insert 4th item, oldest accessed should be evicted
        cache.insert("doc1", 4, 1.0, vec![10, 11, 12]);

        // Key 3 was least recently accessed, so it should be evicted
        assert_eq!(cache.get("doc1", 3, 1.0), None);
        assert_eq!(cache.get("doc1", 4, 1.0), Some(vec![10, 11, 12]));

        // Clear doc
        cache.clear_doc("doc1");
        assert_eq!(cache.get("doc1", 1, 1.0), None);
    }

    #[test]
    fn test_byte_bounded_eviction() {
        // Max 100 bytes budget with capacity 10
        let cache = PageCache::new_with_max_bytes(10, 100);

        // Insert two 40-byte buffers -> total 80 bytes
        cache.insert("doc1", 1, 1.0, vec![1; 40]);
        cache.insert("doc1", 2, 1.0, vec![2; 40]);
        assert_eq!(cache.current_bytes(), 80);

        // Insert another 40-byte buffer -> 80 + 40 = 120 > 100 max_bytes!
        // Should evict page 1 (oldest), keeping total <= 100 bytes
        cache.insert("doc1", 3, 1.0, vec![3; 40]);
        assert_eq!(cache.get("doc1", 1, 1.0), None);
        assert_eq!(cache.get("doc1", 2, 1.0), Some(vec![2; 40]));
        assert_eq!(cache.get("doc1", 3, 1.0), Some(vec![3; 40]));
        assert_eq!(cache.current_bytes(), 80);
    }
}

