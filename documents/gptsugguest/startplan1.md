**TL;DR**

ข้อสรุปนั้น **ถูกทางแล้ว** และดีกว่าการรื้อทั้งระบบทันทีชัดเจน
ผมเห็นด้วยเกือบทั้งหมด โดยเฉพาะประเด็น **“เพิ่ม layout-group metadata แบบ incremental”** แทน **“balloon-first schema rewrite”** ตอนนี้

แต่มี 4 จุดที่ผมอยากให้สั่ง codex เพิ่มให้ชัด ก่อนลงมือจริง ไม่งั้นมีโอกาสได้ของที่ “พอใช้” แต่ไม่เสถียรพอสำหรับ maintain ระยะยาว

---

# ความเห็นตรง ๆ

## สิ่งที่สรุปมาถูก

อันนี้ผมเห็นด้วย:

* root cause อยู่ที่ **pre-translation grouping/order**
* ยังไม่ควรเปลี่ยน `OCRPageResult.lines` ทั้งระบบทันที
* ควรเพิ่ม **layout grouping layer** แยกออกมา
* ควร hook **ก่อน** `buildTranslationGroups()`
* ควรทำ pixel-based balloon / speech-region logic ใน OCR bridge หรือ worker ไม่ใช่ใน React
* `join('\n')` ดีกว่า `join(' ')` สำหรับ dialogue grouping

นี่เป็นทิศทางที่ practical และไม่ทำให้ cache / overlay / export พังเป็นลูกโซ่

---

# สิ่งที่ควรสั่ง codex เพิ่มให้ชัด

## 1) ห้ามให้ grouping logic ไปแก้ raw line order ต้นฉบับ

อันนี้สำคัญมาก

ให้ codex ยึดกฎนี้เลย:

* `raw OCR lines` = immutable
* `derived reading order` = ของใหม่
* `translation grouping order` = ของใหม่
* ห้าม reorder array ต้นฉบับแล้วค่อย map กลับทีหลัง

### ทำไม

เพราะพอระบบเก่าอิง line index อยู่หลายจุด
ถ้าไป mutate order กลางทาง แม้จะ “ดูเหมือนยัง map กลับได้” สุดท้ายจะเกิดบั๊กแนวนี้:

* overlay highlight ไม่ตรง
* search result กระโดดผิดตำแหน่ง
* translation cache mismatch
* per-line editing ผูกผิด line
* exported text order กับ UI order คนละชุด

### สิ่งที่ควรมีแทน

ให้มี structure แยก เช่น:

```ts
type DerivedLayoutGroup = {
  id: string;
  page: number;
  lineIndexes: number[];
  intraGroupOrder: number[];
  interGroupOrder: number;
  confidence: number;
  readingMode: 'ltr' | 'rtl' | 'ttb' | 'auto';
  strategy: 'geometry' | 'region' | 'hybrid';
};
```

และมี `derivedOrderedLineIndexes: number[]` แยกจาก raw lines ไปเลย

---

## 2) ต้องกำหนด contract ของ grouping service ให้ชัด

ตอนนี้ summary บอกว่าให้เพิ่ม layout grouping layer ซึ่งถูก
แต่ถ้าไม่กำหนด API ให้ชัด codex มักจะเริ่มเขียนแบบพันกับ App.tsx อีก

### ผมแนะนำ contract แบบนี้

input:

* page image metadata
* OCR lines พร้อม quad / bbox / angle / confidence / text
* page mode config

output:

* groups
* ordered group ids
* ordered line indexes per group
* ungrouped lines
* diagnostics/debug data

ตัวอย่าง:

```ts
type LayoutGroupingInput = {
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  lines: OCRLineWithLayout[];
  mode: 'default' | 'dense-dialogue' | 'balloon-aware';
  readingMode: 'auto' | 'ltr' | 'rtl' | 'ttb';
};

type LayoutGroupingResult = {
  groups: DerivedLayoutGroup[];
  ungroupedLineIndexes: number[];
  orderedGroupIds: string[];
  orderedLineIndexes: number[];
  diagnostics: {
    strategy: 'geometry' | 'region' | 'hybrid';
    avgConfidence: number;
    warnings: string[];
  };
};
```

### เหตุผล

* test ง่าย
* replace implementation ภายหลังง่าย
* App layer ไม่ต้องรู้รายละเอียด clustering ภายใน

---

## 3) อย่าเริ่มจาก connected-components ก่อน ถ้ายังไม่มี debug overlay

ผมเห็นด้วยกับ Phase 2 ที่เพิ่ม white speech-region assignment
แต่ **อย่าเพิ่งทำเป็น phase แรกของ implementation** ถ้ายังไม่มีเครื่องมือ debug ที่มองเห็นผลลัพธ์จริง

### ลำดับที่ควรเป็น

1. geometry-only grouping
2. debug overlay สำหรับ:

   * line box
   * quad
   * group id
   * intra-group order
   * inter-group order
3. benchmark กับ sample pages จริง
4. ค่อยเพิ่ม connected-components เป็น strong constraint

### ทำไม

เพราะถ้าทำ region extraction ก่อน แล้วผล grouping ผิด
มึงจะไม่รู้ว่าพังเพราะ:

* threshold
* morphology
* contour assignment
* OCR box quality
* panel border leakage
* หรือ grouping logic เอง

เริ่มจาก geometry-only ก่อนจะ isolate root cause ง่ายกว่าเยอะ

---

## 4) ต้องมี fallback strategy ที่ deterministic

อย่าให้ระบบ “พยายามฉลาด” แล้วเดาผิดมั่ว ๆ โดยไม่มีทางถอย

### สั่ง codex ให้ทำ policy แบบนี้

ถ้า grouping confidence ต่ำ:

* fallback ไป dense-dialogue grouping เดิม
* หรือ fallback ไป raw order + newline join
* พร้อม tag diagnostic ว่า `layoutGroupingSkipped: true`

### ห้าม

* confidence ต่ำแต่ยังบังคับ merge lines เข้ากลุ่ม
* confidence ต่ำแต่ยัง reorder เยอะ
* confidence ต่ำแต่ cache ผลถาวรเหมือน confident result

### แนะนำ field เพิ่ม

```ts
type GroupingDecision = {
  appliedProfile: 'raw' | 'dense-dialogue' | 'balloon-aware';
  confidence: number;
  fallbackReason?: string;
};
```

---

# จุดที่ผมอยากแก้จากสรุปเดิมนิดหนึ่ง

## เรื่อง `join('\n')`

ถูก แต่ไม่พอ

อย่าสั่งแค่ “เปลี่ยนจาก `join(' ')` เป็น `join('\n')`” อย่างเดียว
ให้ codex แยก **group composition policy** ไปเลย

เช่น:

* balloon/dialogue group -> `\n`
* paragraph/narration merged block -> `' '`
* vertical text normalized flow -> `\n`
* mixed punctuation fragments -> configurable

เพราะถ้าใช้ `\n` ทุกกรณี ก็มี side effect กับบางภาษา/บาง bubble ที่ OCR แตก fragment เยอะเกินจริง

สรุปคือ:

* `join('\n')` = quick win จริง
* แต่ควรห่อไว้ใน policy function ไม่ใช่ hardcode กระจาย

ตัวอย่าง:

```ts
function composeGroupSourceText(
  lines: string[],
  groupType: 'dialogue' | 'narration' | 'unknown'
): string {
  if (groupType === 'dialogue') return lines.join('\n');
  if (groupType === 'narration') return lines.join(' ');
  return lines.join('\n');
}
```

---

## เรื่อง `quad + angleDeg`

อย่าเก็บแค่ metadata แล้วจบ
ให้ codexเช็คด้วยว่า **translation path ใช้มันจริงหรือยัง**

หลายทีมชอบเพิ่ม schema แล้วสุดท้ายไม่มี consumer ใช้จริง

ดังนั้นใน phase 1 ต้องมีอย่างน้อย:

* OCR bridge คืน `quad`
* grouping service ใช้ `quad centroid / box height / angleDeg`
* debug panel แสดงค่าเหล่านี้ได้
* unit tests cover grouping จาก metadata นี้

---

# Implementation order ที่ผมแนะนำจริง

## Phase 1A — Schema + isolation

ให้ codex ทำก่อนเลย:

* เพิ่ม `quad`, `angleDeg`, `sortHintX`, `sortHintY`, `sourceEngine`, `layoutHints?`
* สร้าง `balloonAwareGroupingService.ts`
* ห้ามแก้ cache schema หลักเกินจำเป็น
* เพิ่ม adapter แปลงจาก OCR result -> grouping input

## Phase 1B — Geometry-only grouping

ทำ heuristic ล้วนก่อน:

* centroid distance
* normalized gap
* angle similarity
* size similarity
* overlap / band relation
* configurable reading mode

ผลลัพธ์:

* groups
* intra-group order
* inter-group order
* confidence

## Phase 1C — Translation hook

เสียบก่อน `buildTranslationGroups()`

flow:

* ถ้า profile = balloon-aware และ confidence ผ่าน threshold

  * ใช้ derived groups
* ไม่งั้น fallback ของเดิม

## Phase 1D — Diagnostics

เพิ่ม debug UI/console dump:

* raw order
* derived order
* group membership
* final composed text before Argos

อันนี้จำเป็น ไม่ใช่ของแถม

---

# จุดที่ควรสั่ง codex “อย่าทำ”

## อย่า

* rewrite `translatedByIndex` ตอนนี้
* ผูก group id เข้ากับ persistent cache key ตั้งแต่รอบแรก
* ย้าย logic clustering ไปไว้ใน React component
* ทำ async spaghetti ใน `App.tsx`
* hardcode manga mode ตายตัวโดยไม่รองรับ `readingMode`

---

# จุดที่ควรสั่ง codex “ทำเพิ่ม”

## 1. สร้าง test fixtures

ให้มี sample pages 6–10 แบบ:

* balloon เดียวหลายกล่อง
* กล่องเอียง
* dense dialogue
* narration box
* mixed panel layout
* false positive text fragments

แล้วเขียน snapshot test ของ grouping result

ถ้าไม่มี fixture ตั้งแต่แรก เดี๋ยว regression มาแน่

---

## 2. เก็บ debug export

ให้สามารถ export JSON ของหน้าได้ เช่น:

```json
{
  "rawLines": [],
  "derivedGroups": [],
  "orderedLineIndexes": [],
  "composedGroupTexts": []
}
```

ไว้เทียบก่อน/หลังปรับ heuristic

---

## 3. ใส่ feature flag

เช่น:

* `enableBalloonAwareGrouping`
* `enableSpeechRegionConstraint`
* `layoutGroupingDebug`

เพื่อ rollout แบบคุมได้

---

# คำสั่งที่คุณส่งให้ codex ได้เลย

ส่งแบบนี้ได้ค่อนข้างตรง:

---

ให้ implement แบบ incremental ตามนี้:

1. **ห้าม mutate raw OCR lines order**

   * raw line indexes ต้องคงเดิมเพื่อไม่ให้ cache/overlay/search/export พัง
   * ให้สร้าง derived layout grouping/order แยกออกมา

2. **สร้าง service ใหม่ `balloonAwareGroupingService.ts`**

   * input: OCR lines + quad + angleDeg + sort hints + page metadata + reading mode
   * output: groups, orderedGroupIds, orderedLineIndexes, ungroupedLineIndexes, confidence, diagnostics
   * service ต้อง pure และ testable

3. **Phase 1 ใช้ geometry-only grouping ก่อน**

   * ใช้ centroid distance, size similarity, angle similarity, band overlap, reading mode heuristics
   * ยังไม่ต้องทำ heavy segmentation model
   * connected-components speech-region assignment ค่อยเป็น phase 2

4. **hook service ก่อน `buildTranslationGroups()`**

   * ถ้า balloon-aware confidence สูงพอ ให้ compose source text per group
   * ถ้าไม่พอ ให้ fallback ไป dense-dialogue/raw strategy เดิม
   * อย่าเปลี่ยน translation mapping ปลายทางที่ยังอิง translatedByIndex ตอนนี้

5. **แยก group text composition policy**

   * dialogue/balloon group ใช้ `join('\n')`
   * อย่า hardcode `join('\n')` กระจายหลายจุด
   * ทำเป็น helper/function เดียว

6. **เพิ่ม diagnostics/debug tools**

   * debug overlay หรือ debug JSON ที่แสดง raw order, derived group membership, intra/inter-group order, composed group texts
   * ต้องดูได้ว่าผลก่อนส่ง Argos เป็นอะไร

7. **ใส่ feature flags**

   * `enableBalloonAwareGrouping`
   * `layoutGroupingDebug`
   * phase 2 ค่อยเพิ่ม `enableSpeechRegionConstraint`

8. **เพิ่ม tests + fixtures**

   * อย่างน้อยต้องมี sample cases สำหรับ rotated text, multi-box single balloon, dense dialogue, narration box, mixed layout

---
