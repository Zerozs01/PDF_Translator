# PIPELINE HANDOFF: 2026-05-09
## Status: Stabilized Offline Translation & Balloon Detection

### 1. Core Changes Summary
The recent sessions focused on making the **Offline (Argos) Translation** more robust against comic/manga OCR noise and fixing fragmented speech balloon borders.

### 2. Key Technical Implementations
- **Unconditional Lowercasing**: Removed complex `upperRatio` and `mixedCase` heuristics. All Latin text is now lowercased before being sent to Argos. This prevents translation "blackouts" caused by OCR noise (e.g., "FAiR" blocking the translation of a whole balloon).
- **Early Noise Repair**: Noise repair is now applied during `collectTranslatableLines` (the very start of the pipeline). This cleans artifacts like trailing underscores (`HUH_`) and split possessives before grouping or caching occurs.
- **Semantic Protection**:
    - **`I`, `A`, `O`, `OK`, `NO`, `HI`, `OH`, `HUH`** are now explicitly exempted from the **Ghost Filter** and **Scientific Symbol Filter**.
    - This ensures they always get a translation border and are sent to the translator, even if they appear as tiny single-character boxes.
- **Balloon Harmonization**: Relaxed grouping thresholds in `shouldHarmonizeOverlayBlock`.
    - Increased `heightRatio` tolerance to **3.2**.
    - Increased `verticalGap` tolerance to **3.0x avgHeight**.
    - This ensures top-most lines are correctly included in the conversational balloon border/mask.

### 3. Files Modified
- `src/App.tsx`: Normalization logic, ghost filtering, and collection pipeline.
- `src/components/OCR/translationOverlayUtils.ts`: Balloon grouping heuristics.
- `src/App.translationDedupe.test.ts`: Updated unit tests for 'I' retention.

### 4. Next Steps / Remaining Issues
- **Offline Cache Management**: Users should "Clear Cache" when logic changes significantly to ensure new normalization takes effect.
- **EasyOCR vs PaddleOCR**: EasyOCR still occasionally struggles with horizontal word splitting in multi-balloon rows compared to PaddleOCR. This may require further `word-union` tuning if specific cases persist.

### 5. Reference for New Chat
If starting a new session, please read `src/App.tsx` around `normalizeSourceForTranslation` and `collectTranslatableLines` to understand the current normalization flow.
