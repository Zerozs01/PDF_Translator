# Fix Babel "Unexpected reserved word 'await'" in OCRTextLayerPanel.tsx

## Step 1: Fix Vite Babel config [IN PROGRESS]
- [ ] Edit vite.config.ts: Add @babel/preset-env + ES2022 async/await support
- Test: `npm run dev` → no build errors

## Step 2: Refactor OCRTextLayerPanel (5873→~800 lines)
- [ ] Extract `useOCREngine.ts` hook
- [ ] Extract `OCRControls.tsx` component  
- [ ] Extract `OCRPreview.tsx` component
- [ ] Extract `BenchmarkPanel.tsx` component

## Step 3: Verify
- [ ] Single page OCR ✓
- [ ] Batch OCR ✓
- [ ] Benchmark table ✓
- [ ] Translation preview toggle ✓
- [ ] Cache load/clear ✓

## Perf Targets
- Bundle size -40%
- Hot reload <2s
- Memory <450MB @ 100 pages

