//! Adobe Photoshop PSD Binary Writer (8BPS Specification).
//! Serializes PsdDocument into compliant .psd files with separate background and text layers.

use super::document::PsdDocument;
use super::packbits::packbits_encode;
use std::io::{Cursor, Seek, SeekFrom, Write};

pub struct PsdWriter;

impl PsdWriter {
    /// Serializes a PsdDocument into raw binary .psd bytes.
    pub fn write_to_bytes(doc: &PsdDocument) -> Result<Vec<u8>, String> {
        let mut w = Cursor::new(Vec::with_capacity(1024 * 1024));

        // ──────────────── 1. Header Section (26 bytes) ────────────────
        w.write_all(b"8BPS").map_err(|e| e.to_string())?; // Signature
        w.write_all(&1u16.to_be_bytes()).map_err(|e| e.to_string())?; // Version 1
        w.write_all(&[0u8; 6]).map_err(|e| e.to_string())?; // 6 Reserved bytes
        w.write_all(&3u16.to_be_bytes()).map_err(|e| e.to_string())?; // 3 Channels (RGB)
        w.write_all(&doc.height.to_be_bytes()).map_err(|e| e.to_string())?; // Height
        w.write_all(&doc.width.to_be_bytes()).map_err(|e| e.to_string())?; // Width
        w.write_all(&8u16.to_be_bytes()).map_err(|e| e.to_string())?; // 8-bit depth
        w.write_all(&3u16.to_be_bytes()).map_err(|e| e.to_string())?; // ColorMode: RGB (3)

        // ──────────────── 2. Color Mode Data Section ────────────────
        w.write_all(&0u32.to_be_bytes()).map_err(|e| e.to_string())?; // 0 length for RGB

        // ──────────────── 3. Image Resources Section ────────────────
        // Write standard 300 DPI ResolutionInfo block (0x03ED)
        let mut res_block = Vec::new();
        // HRes 300 DPI (fixed 32-bit: 300.0 * 65536 = 19660800)
        res_block.extend_from_slice(&(19660800u32).to_be_bytes());
        res_block.extend_from_slice(&1u16.to_be_bytes()); // DisplayUnit: PixelsPerInch
        res_block.extend_from_slice(&1u16.to_be_bytes()); // WidthUnit: Inches
        // VRes 300 DPI
        res_block.extend_from_slice(&(19660800u32).to_be_bytes());
        res_block.extend_from_slice(&1u16.to_be_bytes()); // DisplayUnit: PixelsPerInch
        res_block.extend_from_slice(&1u16.to_be_bytes()); // HeightUnit: Inches

        let mut res_section = Vec::new();
        res_section.extend_from_slice(b"8BIM");
        res_section.extend_from_slice(&0x03EDu16.to_be_bytes()); // ResolutionInfo
        res_section.extend_from_slice(&0u16.to_be_bytes()); // Empty name Pascal string
        res_section.extend_from_slice(&(res_block.len() as u32).to_be_bytes());
        res_section.extend_from_slice(&res_block);

        w.write_all(&(res_section.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;
        w.write_all(&res_section).map_err(|e| e.to_string())?;

        // ──────────────── 4. Layer & Mask Information Section ────────────────
        let layer_section_start = w.position();
        w.write_all(&0u32.to_be_bytes()).map_err(|e| e.to_string())?; // Placeholder for Layer Section Length

        if !doc.layers.is_empty() {
            let layer_info_start = w.position();
            w.write_all(&0u32.to_be_bytes()).map_err(|e| e.to_string())?; // Placeholder for Layer Info Length

            // Layer count (positive i16)
            let layer_count = doc.layers.len() as i16;
            w.write_all(&layer_count.to_be_bytes()).map_err(|e| e.to_string())?;

            // Pre-compress layer channels with PackBits RLE to calculate lengths
            struct LayerChannelData {
                r_compressed: Vec<u8>,
                g_compressed: Vec<u8>,
                b_compressed: Vec<u8>,
                a_compressed: Vec<u8>,
            }

            let mut compressed_layers: Vec<LayerChannelData> = Vec::with_capacity(doc.layers.len());

            for layer in &doc.layers {
                let l_width = layer.width() as usize;
                let l_height = layer.height() as usize;

                let compress_channel = |chan_data: &[u8]| -> Vec<u8> {
                    let mut out = Vec::new();
                    // PackBits compression: 2 bytes method (1 = RLE) + scanline byte lengths (2 * height) + compressed lines
                    out.extend_from_slice(&1u16.to_be_bytes());

                    let mut scanline_bytes = Vec::new();
                    let mut scanline_lens = Vec::new();

                    for row in 0..l_height {
                        let row_start = row * l_width;
                        let row_end = (row_start + l_width).min(chan_data.len());
                        let row_slice = if row_start < chan_data.len() {
                            &chan_data[row_start..row_end]
                        } else {
                            &[]
                        };
                        let comp = packbits_encode(row_slice);
                        scanline_lens.push(comp.len() as u16);
                        scanline_bytes.extend_from_slice(&comp);
                    }

                    for len in scanline_lens {
                        out.extend_from_slice(&len.to_be_bytes());
                    }
                    out.extend_from_slice(&scanline_bytes);
                    out
                };

                let r_c = compress_channel(&layer.r);
                let g_c = compress_channel(&layer.g);
                let b_c = compress_channel(&layer.b);
                let a_c = compress_channel(layer.a.as_deref().unwrap_or(&[]));

                compressed_layers.push(LayerChannelData {
                    r_compressed: r_c,
                    g_compressed: g_c,
                    b_compressed: b_c,
                    a_compressed: a_c,
                });
            }

            // Write Layer Records
            for (idx, layer) in doc.layers.iter().enumerate() {
                w.write_all(&layer.top.to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&layer.left.to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&layer.bottom.to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&layer.right.to_be_bytes()).map_err(|e| e.to_string())?;

                // Channels count: 4 (R, G, B, A)
                w.write_all(&4u16.to_be_bytes()).map_err(|e| e.to_string())?;

                let cl = &compressed_layers[idx];
                // Channel 0 (Red)
                w.write_all(&0i16.to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&(cl.r_compressed.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;

                // Channel 1 (Green)
                w.write_all(&1i16.to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&(cl.g_compressed.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;

                // Channel 2 (Blue)
                w.write_all(&2i16.to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&(cl.b_compressed.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;

                // Channel -1 (Transparency Mask / Alpha)
                w.write_all(&(-1i16).to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&(cl.a_compressed.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;

                // Blend mode: 8BIM norm
                w.write_all(b"8BIMnorm").map_err(|e| e.to_string())?;
                w.write_all(&[layer.opacity, 0u8]).map_err(|e| e.to_string())?; // Opacity & Clipping (0)
                let flags = if layer.visible { 0x08u8 } else { 0x0au8 }; // 0x08 = visible
                w.write_all(&[flags, 0u8]).map_err(|e| e.to_string())?; // Flags & Filler

                // Extra Data
                let mut extra = Vec::new();
                extra.extend_from_slice(&0u32.to_be_bytes()); // Layer mask data length: 0
                extra.extend_from_slice(&0u32.to_be_bytes()); // Blending ranges length: 0

                // Layer name: Pascal string padded to 4 bytes
                let name_bytes = layer.name.as_bytes();
                let name_len = name_bytes.len().min(255) as u8;
                let mut pascal = Vec::with_capacity(name_len as usize + 4);
                pascal.push(name_len);
                pascal.extend_from_slice(&name_bytes[..name_len as usize]);
                while pascal.len() % 4 != 0 {
                    pascal.push(0);
                }
                extra.extend_from_slice(&pascal);

                w.write_all(&(extra.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;
                w.write_all(&extra).map_err(|e| e.to_string())?;
            }

            // Write Channel Image Data for each layer
            for cl in compressed_layers {
                w.write_all(&cl.r_compressed).map_err(|e| e.to_string())?;
                w.write_all(&cl.g_compressed).map_err(|e| e.to_string())?;
                w.write_all(&cl.b_compressed).map_err(|e| e.to_string())?;
                w.write_all(&cl.a_compressed).map_err(|e| e.to_string())?;
            }

            // Backfill Layer Info Length
            let current_pos = w.position();
            let info_len = (current_pos - layer_info_start - 4) as u32;
            w.seek(SeekFrom::Start(layer_info_start)).map_err(|e| e.to_string())?;
            w.write_all(&info_len.to_be_bytes()).map_err(|e| e.to_string())?;
            w.seek(SeekFrom::Start(current_pos)).map_err(|e| e.to_string())?;
        }

        // Backfill Layer & Mask Section Length
        let end_layer_section = w.position();
        let section_len = (end_layer_section - layer_section_start - 4) as u32;
        w.seek(SeekFrom::Start(layer_section_start)).map_err(|e| e.to_string())?;
        w.write_all(&section_len.to_be_bytes()).map_err(|e| e.to_string())?;
        w.seek(SeekFrom::Start(end_layer_section)).map_err(|e| e.to_string())?;

        // ──────────────── 5. Composite Merged Image Section ────────────────
        // Write raw composite merged RGB data (compression = 0: Raw PCM)
        w.write_all(&0u16.to_be_bytes()).map_err(|e| e.to_string())?; // Compression: 0

        // If background layer exists, use its R, G, B channels as composite preview
        let total_pixels = (doc.width * doc.height) as usize;
        let bg_r = doc.layers.first().map(|l| &l.r[..]).unwrap_or(&[]);
        let bg_g = doc.layers.first().map(|l| &l.g[..]).unwrap_or(&[]);
        let bg_b = doc.layers.first().map(|l| &l.b[..]).unwrap_or(&[]);

        let mut write_padded_channel = |chan: &[u8]| -> Result<(), String> {
            if chan.len() >= total_pixels {
                w.write_all(&chan[..total_pixels]).map_err(|e| e.to_string())?;
            } else {
                w.write_all(chan).map_err(|e| e.to_string())?;
                let remaining = total_pixels - chan.len();
                let zeros = vec![255u8; remaining]; // default white
                w.write_all(&zeros).map_err(|e| e.to_string())?;
            }
            Ok(())
        };

        write_padded_channel(bg_r)?;
        write_padded_channel(bg_g)?;
        write_padded_channel(bg_b)?;

        Ok(w.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::pdf::psd::document::{PsdDocument, PsdLayer};

    #[test]
    fn test_psd_writer_header_and_layers() {
        let mut doc = PsdDocument::new(100, 100);

        // Add background layer
        let bg_rgba = vec![255u8; 100 * 100 * 4];
        let bg_layer = PsdLayer::new(
            "Background".to_string(),
            0,
            0,
            100,
            100,
            &bg_rgba,
            255,
            true,
        );
        doc.add_layer(bg_layer);

        // Add text layer overlay
        let text_rgba = vec![0u8; 50 * 20 * 4];
        let mut text_layer = PsdLayer::new(
            "Translation_Line_1".to_string(),
            10,
            10,
            50,
            20,
            &text_rgba,
            255,
            true,
        );
        text_layer.is_text = true;
        text_layer.text_content = Some("สวัสดี".to_string());
        doc.add_layer(text_layer);

        let psd_bytes = PsdWriter::write_to_bytes(&doc).expect("Failed to write PSD");

        // Validate 8BPS signature
        assert_eq!(&psd_bytes[0..4], b"8BPS");
        // Validate Version = 1
        assert_eq!(&psd_bytes[4..6], &1u16.to_be_bytes());
        // Validate Channels = 3
        assert_eq!(&psd_bytes[12..14], &3u16.to_be_bytes());
        // Validate Height = 100
        assert_eq!(&psd_bytes[14..18], &100u32.to_be_bytes());
        // Validate Width = 100
        assert_eq!(&psd_bytes[18..22], &100u32.to_be_bytes());
        // Validate Depth = 8
        assert_eq!(&psd_bytes[22..24], &8u16.to_be_bytes());
        // Validate ColorMode = RGB (3)
        assert_eq!(&psd_bytes[24..26], &3u16.to_be_bytes());

        assert!(psd_bytes.len() > 100);
    }
}

