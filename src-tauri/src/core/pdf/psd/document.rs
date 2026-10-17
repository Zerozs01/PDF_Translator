//! In-memory representation of Adobe Photoshop PSD Document & Layers.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsdLayerInput {
    pub name: String,
    pub top: i32,
    pub left: i32,
    pub width: u32,
    pub height: u32,
    pub opacity: Option<u8>,
    pub visible: Option<bool>,
    /// Raw RGBA bytes (width * height * 4)
    pub rgba_data: Option<Vec<u8>>,
    pub is_text: Option<bool>,
    pub text_content: Option<String>,
    pub font_size: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct PsdLayer {
    pub name: String,
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
    pub opacity: u8,
    pub visible: bool,
    /// Channel Red (8-bit)
    pub r: Vec<u8>,
    /// Channel Green (8-bit)
    pub g: Vec<u8>,
    /// Channel Blue (8-bit)
    pub b: Vec<u8>,
    /// Transparency Mask Alpha (8-bit)
    pub a: Option<Vec<u8>>,
    pub is_text: bool,
    pub text_content: Option<String>,
    pub font_size: Option<f32>,
}

impl PsdLayer {
    pub fn new(
        name: String,
        left: i32,
        top: i32,
        width: u32,
        height: u32,
        rgba: &[u8],
        opacity: u8,
        visible: bool,
    ) -> Self {
        let pixel_count = (width * height) as usize;
        let mut r = Vec::with_capacity(pixel_count);
        let mut g = Vec::with_capacity(pixel_count);
        let mut b = Vec::with_capacity(pixel_count);
        let mut a = Vec::with_capacity(pixel_count);

        for chunk in rgba.chunks_exact(4) {
            r.push(chunk[0]);
            g.push(chunk[1]);
            b.push(chunk[2]);
            a.push(chunk[3]);
        }

        // Fill remaining if needed
        if r.len() < pixel_count {
            r.resize(pixel_count, 0);
            g.resize(pixel_count, 0);
            b.resize(pixel_count, 0);
            a.resize(pixel_count, 255);
        }

        Self {
            name,
            top,
            left,
            bottom: top + height as i32,
            right: left + width as i32,
            opacity,
            visible,
            r,
            g,
            b,
            a: Some(a),
            is_text: false,
            text_content: None,
            font_size: None,
        }
    }

    pub fn width(&self) -> u32 {
        (self.right - self.left).max(0) as u32
    }

    pub fn height(&self) -> u32 {
        (self.bottom - self.top).max(0) as u32
    }
}

#[derive(Debug, Clone)]
pub struct PsdDocument {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<PsdLayer>,
}

impl PsdDocument {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            layers: Vec::new(),
        }
    }

    pub fn add_layer(&mut self, layer: PsdLayer) {
        self.layers.push(layer);
    }
}
