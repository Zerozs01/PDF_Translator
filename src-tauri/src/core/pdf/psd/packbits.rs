//! PackBits RLE compression algorithm according to Adobe Photoshop PSD Specification.

/// Compresses a slice of bytes using the PackBits (RLE) algorithm.
///
/// Rules:
/// - Runs of 2 to 128 repeated bytes are encoded as `-(count - 1)` (i8) followed by the single byte.
/// - Literals of 1 to 128 non-repeated bytes are encoded as `count - 1` (i8) followed by the bytes.
/// - `128` (0x80) is a no-op / reserved byte.
pub fn packbits_encode(input: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    let mut i = 0;

    while i < input.len() {
        // Check for repeated run
        let mut run_len = 1;
        while i + run_len < input.len() && input[i + run_len] == input[i] && run_len < 128 {
            run_len += 1;
        }

        if run_len >= 3 || (run_len == 2 && i + 2 == input.len()) {
            // Encode run: -(run_len - 1)
            let header = (1i16 - run_len as i16) as i8;
            output.push(header as u8);
            output.push(input[i]);
            i += run_len;
        } else {
            // Encode literal sequence
            let mut lit_len = 0;
            while i + lit_len < input.len() && lit_len < 128 {
                // If a run of 3 or more starts here, terminate current literal
                if i + lit_len + 2 < input.len()
                    && input[i + lit_len] == input[i + lit_len + 1]
                    && input[i + lit_len] == input[i + lit_len + 2]
                {
                    break;
                }
                lit_len += 1;
            }

            if lit_len > 0 {
                let header = (lit_len - 1) as u8;
                output.push(header);
                output.extend_from_slice(&input[i..i + lit_len]);
                i += lit_len;
            }
        }
    }

    output
}

/// Decompresses PackBits encoded bytes back into raw bytes.
pub fn packbits_decode(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut i = 0;

    while i < input.len() {
        let header = input[i] as i8;
        i += 1;

        if header == -128 {
            // No-op
            continue;
        } else if header >= 0 {
            // Literal bytes: count = header + 1
            let count = (header as usize) + 1;
            if i + count > input.len() {
                return Err("PackBits decode error: unexpected EOF in literal".to_string());
            }
            output.extend_from_slice(&input[i..i + count]);
            i += count;
        } else {
            // Run: count = 1 - header
            let count = (1 - (header as i16)) as usize;
            if i >= input.len() {
                return Err("PackBits decode error: unexpected EOF in run byte".to_string());
            }
            let byte = input[i];
            i += 1;
            output.resize(output.len() + count, byte);
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packbits_roundtrip_empty() {
        let raw = b"";
        let enc = packbits_encode(raw);
        let dec = packbits_decode(&enc).unwrap();
        assert_eq!(dec, raw);
    }

    #[test]
    fn test_packbits_roundtrip_runs() {
        let raw = b"AAAAABBBBBCCCCCCCCCDDDDD";
        let enc = packbits_encode(raw);
        let dec = packbits_decode(&enc).unwrap();
        assert_eq!(dec, raw);
        assert!(enc.len() < raw.len());
    }

    #[test]
    fn test_packbits_roundtrip_literals() {
        let raw = b"abcdefghijklmnop1234567890";
        let enc = packbits_encode(raw);
        let dec = packbits_decode(&enc).unwrap();
        assert_eq!(dec, raw);
    }
}
