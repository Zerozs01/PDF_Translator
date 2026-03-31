# Making Tesseract OCR Feel Like Snipping Tool in Your Electron App

## TL;DR

You can get **much closer** to Snipping Tool’s “instant + stable” feel with Tesseract, but you won’t fully match it on many PCs because Snipping Tool can use **Windows’ native OCR stack** (and on supported devices, **NPU-accelerated Windows AI OCR**). citeturn10search1turn10search0  
To close the gap with Tesseract, the highest-impact optimizations are: **use the right model set (fast vs best), stop OCR-ing whole pages when you only need regions, and fix worker lifecycle + concurrency** (prewarm, reuse, bounded worker pools, reset strategy). citeturn8search3turn3view1turn11view0turn11view1  
In your repo’s terms: implement a *real* “fast architecture” (region-first + single-pass) for `panel`, keep the expensive rescues for `export`, and make cache identity include **model-set + init-only params** so you don’t reuse mismatched outputs. citeturn8search3turn12view0turn11view1  

## Why Tesseract Usually Feels Slower Than Snipping Tool

Snipping Tool explicitly states its OCR runs **locally on-device**, and Windows’ newer OCR surface (Windows AI TextRecognizer) is **hardware-accelerated on NPU devices** and described as “faster and more accurate” than legacy Windows OCR. citeturn10search1turn10search0  

Tesseract’s modern recognition is also a neural engine (LSTM), and the project documents that the LSTM engine delivers higher accuracy but at the cost of **significantly higher compute** on typical document images. citeturn2search9turn2search24  

So: Snipping Tool’s baseline is “native + OS-integrated + potentially NPU accelerated,” while Tesseract is “general-purpose OCR on CPU (unless you do heavy engineering).” That doesn’t mean Tesseract can’t feel fast—it means you must **aggressively reduce the amount of work per OCR request** and eliminate avoidable overhead.

## The Big Levers That Actually Move Tesseract Toward Snipping-Speed

### Model choice: fast vs best is not a cosmetic toggle

Tesseract ships different official traineddata sets with explicit speed/accuracy trade-offs:

- `tessdata_fast`: “best value for money” speed vs accuracy; **integer models** (8-bit) and intended to be fast. citeturn8search2turn8search0  
- `tessdata_best`: best evaluation results, slower; **float models** and also the base for certain fine-tuning workflows. citeturn8search2turn8search3  

Critical implication for your `ocrQualityProfile`:
- **`panel/fast` should always run `tessdata_fast`** (or equivalent “fast language data” if using a JS/WASM wrapper).  
- **`export/best` should run `tessdata_best`** (because export is throughput-oriented, and you can amortize cost).  

If you’re in a JS/WASM stack like Tesseract.js, their own performance guide explicitly recommends experimenting with **fast language data** and calls out that defaults are optimized for quality. citeturn11view0  

### Segmentation: stop doing full-page OCR when you only need “text here”

Your Knowledge.md already says detection-first/region-first is the high-upside path. That’s not just accuracy—it’s the #1 performance win too.

Tesseract’s own “ImproveQuality” guidance is blunt:

- If you OCR a small region, pick an appropriate `--psm` mode and don’t treat it like a full page. citeturn3view1  
- Cropping matters: too-big borders can cause “empty page,” and too-tight crops can confuse; they suggest a *reasonable border* (e.g., ~10px). citeturn3view1  

If you’re using Tesseract.js specifically, it supports a `rectangle` option to recognize **only a region** of an image. citeturn12view0  

In practice for manga/scan pages: “whole page OCR + later filtering” is expensive and creates ghost text. “Find candidate text regions first” lets you:
- reduce pixels processed (speed),
- reduce background texture exposure (accuracy),
- drastically reduce the need for complex rescues (stability).

### Page segmentation mode (PSM): pick the least general mode that matches your input

Tesseract documents the full list of page segmentation modes (PSM). Key ones relevant to your app include:

- `6`: single uniform block of text  
- `7`: single text line  
- `11`: sparse text  
- `13`: “raw line” (single line; bypasses Tesseract-specific hacks) citeturn3view1turn0search5  

Your current pipeline does one primary recognize pass and then lots of filtering/rescues. A faster alternative is: **spend effort choosing `psm` based on the region type** (bubble line vs caption block vs sparse SFX), and reduce rescues.

### Preprocessing: keep it narrow, but use the tools Tesseract actually benefits from

Tesseract’s own docs emphasize:

- It works best around **300 DPI** (or equivalent effective scale) and recommends resizing if DPI is low. citeturn3view1  
- Skew harms line segmentation significantly; deskewing helps. citeturn3view1  
- Tesseract performs binarization internally (Otsu). Starting in Tesseract 5, there are additional Leptonica-based binarization methods (Adaptive Otsu, Sauvola) and thresholding parameters available via `thresholding_` variables. citeturn3view0  

For your repo, that aligns with “evidence-based preprocessing”: don’t relax thresholds globally; instead add targeted preprocessing only where debug payloads prove it helps.

### Dictionaries and init-only params: speed and stability require correct lifecycle

Tesseract is optimized for “sentences of words,” and it uses dictionaries/word lists. Their docs state you can disable dictionaries (e.g., when text isn’t dictionary-like) by setting `load_system_dawg` and `load_freq_dawg` to false. citeturn3view1turn0search10  

But: in many wrappers, these are **init-only** parameters (set during initialization, not after). Tesseract.js explicitly documents that certain parameters (including `load_system_dawg`) are init-only and must be provided before initialization. citeturn12view0  

So if you’re flipping these per job today, you may be paying cost without effect (or worse, creating mismatched cache identity).

## Architecture-Specific Optimization Plan for Your App

Your current architecture is good: single worker slot, queueing, retries, timeout recovery, and cache compatibility checks per page/profile. The performance gap comes from: (a) doing too much work per page and (b) worker lifecycle/model choices not being used as “big levers.”

### Build a true fast path for panel OCR

Right now, `fast/balanced/best` mostly changes DPI and rescue budgets. To feel like Snipping Tool, treat `panel/fast` as a fundamentally different architecture:

**Fast path goal:** “first usable result” in ~100–300ms for typical bubble-sized regions (when feasible), and under ~1s for full page.

Design:

1. **Region proposal (cheap)**
   - If the user selects a rectangle: that’s your region.
   - Otherwise: run a lightweight region proposal (connected components / morphology) to find high-contrast text regions; use your existing background-variance filters as “rejectors” earlier, not later.
   - Store region boxes (geometry is first-class).

2. **Region OCR with narrow PSM**
   - Primary: `psm 7` (single line) for detected line-like regions; `psm 6` for block-like bubbles; `psm 11` for sparse pages. citeturn3view1turn0search5  
   - Use **`tessdata_fast`** (or Tesseract.js fast lang data) for fast profile. citeturn8search3turn11view0  

3. **Minimal post-cleanup**
   - Keep your script-aware cleanup, but remove multi-stage rescues from the fast path.
   - Only schedule rescues if the fast pass fails a confidence/coverage threshold.

This matches your Knowledge.md “detection-first OCR” principle and directly attacks the largest compute cost: full-page recognition.

### Make export throughput scalable without destroying stability

Export is batch/throughput. Your current single worker slot is stable but leaves performance on the table, because Tesseract can be run as **multiple independent instances in parallel**.

Tesseract’s API documentation states that using multiple `TessBaseAPI` instances in different threads is basically safe, with the caveat that some global parameters remain, and certain `SetVariable` calls can affect all instances. citeturn6search28  

However, you must avoid CPU oversubscription:

- Tesseract’s docs note OpenMP builds can waste CPU and are disabled by default in newer releases; they suggest `OMP_THREAD_LIMIT=1` to limit overhead in other versions. citeturn7search8turn6search6  
- Tesseract FAQ similarly recommends `OMP_THREAD_LIMIT` and explicitly mentions `OMP_THREAD_LIMIT=1` to disable multithreading. citeturn7search15  

**Actionable export strategy:**
- Run **N parallel OCR workers** (2–4 on typical desktops; tune by benchmark).
- Ensure each OCR instance is single-threaded internally (OpenMP disabled or `OMP_THREAD_LIMIT=1`).
- Let concurrency happen at the job queue level (page/region parallelism), not inside each Tesseract instance.

If you’re using Tesseract.js, their docs recommend using a **scheduler** to run jobs across a fixed worker pool (e.g., 4 workers), and explicitly warn that creating an arbitrary number of workers can crash due to memory limits. citeturn11view0turn11view1  

### Fix worker lifecycle to eliminate spikes and memory creep

Tesseract.js has unusually strong, explicit guidance here:

- Don’t create/destroy per image; reuse workers. citeturn11view0  
- For parallel jobs, use a scheduler with a fixed pool. citeturn11view0turn11view1  
- In long-running processes, periodically reset workers/schedulers (example: every 500 jobs) because WASM memory only expands and internal dictionaries “learn” and bloat over time. citeturn11view1  

This maps cleanly onto your `VisionService` “worker recreation” machinery—just switch the trigger from only “algorithmVersion change” to also include:
- “processedJobsSinceReset > K”
- “workerMemoryHighWaterMark exceeded”
- “timeout spike frequency exceeded”

### Make cache identity correct (this is a hidden stability killer)

Right now you cache by language/DPI/PSM/algorithmVersion/profile/quality. If you implement the above, you must extend identity to include:

- **traineddata set** (`fast` vs `best`) and (if applicable) its version/hash  
- **engine mode** (`--oem`) and wrapper-specific variants  
- **init-only params** you set (e.g., `load_system_dawg`, `load_freq_dawg`) citeturn3view1turn12view0  

Otherwise you will silently reuse OCR results generated under different assumptions and conclude “Tesseract is unstable,” when it’s actually your cache key.

## Concrete Optimization Recipes You Can Implement Incrementally

### Recipe A: “Snipping-like” panel OCR (fast preview + targeted refine)

**Step 1: Fast preview**
- Render at lower DPI (enough to hit ~300dpi-equivalent for your typical font sizes, but don’t blindly upscale everything).
- Use `tessdata_fast`. citeturn8search3turn8search0  
- PSM based on region type (line vs block vs sparse). citeturn3view1  
- Hard timeout (you already have), and if it hits, immediately return “no text” with debug markers.

**Step 2: Refine only when needed**
- Trigger refine if any of:
  - coverage low (few words detected but region has high edge density),
  - confidence low,
  - script mismatch (e.g., Korean page + Latin-only output).
- Refine uses higher DPI and/or `tessdata_best` and enables your rescue stages.

This keeps UI responsive and pushes cost to “only on hard pages,” which is exactly how you get perceived speed.

### Recipe B: Stop whole-page ghost text by making “region-first” the default on manga exports

You don’t have to ship a full ML layout detector to get a big jump:

- Start with heuristic region proposals (morphology + connected components) and only feed those crops into Tesseract.
- Use `psm 7/13` for single lines and `psm 6` for blocks. citeturn3view1turn0search5  
- Keep a small white border around crops (~10px suggestion is explicitly in docs). citeturn3view1  

On textured backgrounds, this can reduce both false positives and runtime because you avoid OCR on “pure background,” where Tesseract tends to hallucinate low-confidence symbols that you then spend time filtering.

### Recipe C: Tesseract.js-specific performance fixes that are often missed

If you’re in a Tesseract.js-based worker (common in renderer WebWorkers), these are high ROI:

- Prewarm the worker before first OCR (their docs explicitly recommend “set up workers ahead of time”). citeturn11view0  
- Ensure `corePath` points to a directory containing all 4 core files so Tesseract.js can choose the best build; setting it to a single `.js` file is “strongly discouraged” and can degrade performance/compatibility. citeturn12view0turn11view0  
- Use schedulers for export/batch concurrency with a fixed pool (e.g., 4). citeturn11view1  
- Reset workers periodically in long-running sessions to prevent memory expansion and dictionary bloat. citeturn11view1  

## Production-Ready Code Skeleton: Worker Pool + Fast/Best Profiles

Below is a practical pattern that fits your `VisionService` model (queue, cancellation, resets) and supports both panel (single hot worker) and export (bounded pool). This assumes Tesseract.js, because your current OCR runs in a worker context; if you use native Tesseract, the lifecycle pattern is the same but calls change.

```ts
// src/services/vision/engines/tesseractJsEngine.ts
import Tesseract, { type Worker, type Scheduler } from "tesseract.js";

export type OcrQuality = "fast" | "balanced" | "best";
export type PipelineProfile = "panel" | "export";

export type OcrRequest = {
  image: ImageData | string | Uint8Array; // match your actual usage
  language: string;                      // e.g. "eng", "kor", "jpn"
  psm: number;                           // 0..13, choose per region/layout
  userDpi?: number;                      // e.g. 200/300
  rect?: { left: number; top: number; width: number; height: number }; // ROI
  quality: OcrQuality;
  profile: PipelineProfile;
  signal?: AbortSignal;
};

export type OcrResult = {
  text: string;
  tsv?: string;
  blocks?: unknown;
  runtimeMs: number;
  engine: "tesseract.js";
  engineDetails: {
    lang: string;
    oem: number;
    psm: number;
    modelSet: "fast" | "best";
  };
};

type EngineOptions = {
  // IMPORTANT: corePath should be a directory containing all 4 core files.
  corePath?: string;
  // langPath can point to fast models for the fast profile.
  langPathBest?: string;
  langPathFast?: string;
  maxExportWorkers: number; // e.g. 2..4
  resetAfterJobs: number;   // e.g. 300..800
};

export class TesseractJsEngine {
  private readonly opt: EngineOptions;

  private panelWorker: Worker | null = null;
  private exportScheduler: Scheduler | null = null;
  private exportWorkers: Worker[] = [];
  private jobsSinceReset = 0;

  constructor(opt: EngineOptions) {
    this.opt = opt;
  }

  async prewarmPanel(language: string, quality: OcrQuality): Promise<void> {
    // Prewarm costs are real; do it when user first opens OCR panel.
    await this.ensurePanelWorker(language, quality);
  }

  async recognize(req: OcrRequest): Promise<OcrResult> {
    if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const t0 = performance.now();

    if (req.profile === "panel") {
      const worker = await this.ensurePanelWorker(req.language, req.quality);
      const out = await this.runRecognize(worker, req);
      return { ...out, runtimeMs: performance.now() - t0 };
    }

    const scheduler = await this.ensureExportScheduler(req.language, req.quality);
    // Cancellation in Tesseract.js is coarse; on abort, we terminate the scheduler
    // to stop CPU burn, then recreate on next job.
    const abortHandler = () => {
      void this.hardResetExport("abort");
    };
    req.signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      const result = await scheduler.addJob("recognize", req.image, {
        rectangle: req.rect,
      }, {
        // output formats: request what you need (tsv is helpful for geometry)
        tsv: true,
        text: true,
      });

      // Set params per job via recognize options + setParameters.
      // NOTE: Init-only params must be set at createWorker time (not here).
      // We keep per-job params minimal.
      const text = result?.data?.text ?? "";
      const tsv = result?.data?.tsv ?? "";

      this.jobsSinceReset++;
      if (this.jobsSinceReset >= this.opt.resetAfterJobs) {
        void this.hardResetExport("periodic");
      }

      return {
        text,
        tsv,
        runtimeMs: performance.now() - t0,
        engine: "tesseract.js",
        engineDetails: {
          lang: req.language,
          oem: 1,
          psm: req.psm,
          modelSet: req.quality === "best" ? "best" : "fast",
        },
      };
    } finally {
      req.signal?.removeEventListener("abort", abortHandler);
    }
  }

  async dispose(): Promise<void> {
    await this.hardResetPanel();
    await this.hardResetExport("dispose");
  }

  private getLangPath(quality: OcrQuality): string | undefined {
    return quality === "best" ? this.opt.langPathBest : this.opt.langPathFast;
  }

  private async ensurePanelWorker(language: string, quality: OcrQuality): Promise<Worker> {
    // Simplest safe strategy: keep one hot worker for panel.
    // If language/quality changes in a way that impacts init-only settings, recreate.
    if (this.panelWorker) return this.panelWorker;

    this.panelWorker = await Tesseract.createWorker(language, /* oem */ 1, {
      corePath: this.opt.corePath,
      langPath: this.getLangPath(quality),
      logger: () => {}, // optionally wire into your debug payload
    }, {
      // Init-only params belong here (ex: disable dawg if desired for your domain).
      // load_system_dawg: "0",
      // load_freq_dawg: "0",
    });

    await this.panelWorker.setParameters({
      // These can be changed after init:
      tessedit_pageseg_mode: String(6),
      preserve_interword_spaces: "1",
    });

    return this.panelWorker;
  }

  private async ensureExportScheduler(language: string, quality: OcrQuality): Promise<Scheduler> {
    if (this.exportScheduler) return this.exportScheduler;

    this.exportScheduler = Tesseract.createScheduler();
    this.exportWorkers = [];

    const workerN = Math.max(1, this.opt.maxExportWorkers);
    for (let i = 0; i < workerN; i++) {
      const worker = await Tesseract.createWorker(language, 1, {
        corePath: this.opt.corePath,
        langPath: this.getLangPath(quality),
        logger: () => {},
      }, {
        // Init-only params here if you choose to use them.
      });

      // IMPORTANT: Workers in a scheduler must be homogeneous.
      await worker.setParameters({
        tessedit_pageseg_mode: String(6),
        preserve_interword_spaces: "1",
      });

      this.exportScheduler.addWorker(worker);
      this.exportWorkers.push(worker);
    }

    return this.exportScheduler;
  }

  private async runRecognize(worker: Worker, req: OcrRequest): Promise<OcrResult> {
    // Keep this minimal; heavy rescues belong in your own pipeline stages.
    await worker.setParameters({
      tessedit_pageseg_mode: String(req.psm),
      ...(req.userDpi ? { user_defined_dpi: String(req.userDpi) } : {}),
    });

    const out = await worker.recognize(req.image, req.rect ? { rectangle: req.rect } : undefined, {
      text: true,
      tsv: true,
    });

    return {
      text: out?.data?.text ?? "",
      tsv: out?.data?.tsv ?? "",
      runtimeMs: 0,
      engine: "tesseract.js",
      engineDetails: {
        lang: req.language,
        oem: 1,
        psm: req.psm,
        modelSet: req.quality === "best" ? "best" : "fast",
      },
    };
  }

  private async hardResetPanel(): Promise<void> {
    if (!this.panelWorker) return;
    try {
      await this.panelWorker.terminate();
    } finally {
      this.panelWorker = null;
    }
  }

  private async hardResetExport(reason: "abort" | "periodic" | "dispose"): Promise<void> {
    if (!this.exportScheduler) return;
    try {
      await this.exportScheduler.terminate();
    } finally {
      this.exportScheduler = null;
      this.exportWorkers = [];
      this.jobsSinceReset = 0;
      // Optionally log `reason` via your debug payload.
      void reason;
    }
  }
}
```

Why this matches the research:
- Reuses workers (never per-image create/destroy). citeturn11view0  
- Uses scheduler/pool for parallel export. citeturn11view1  
- Treats init-only parameters as init-only (set at creation, not later). citeturn12view0  
- Makes “reset after K jobs” a first-class stability rule (WASM memory expansion + dictionary bloat). citeturn11view1  

## Trade-offs and What You Still Won’t Get With Tesseract Alone

Even with all optimizations:

- You still won’t match Windows AI OCR on Copilot+ PCs because those APIs are explicitly hardware-accelerated on an NPU and positioned as faster than legacy OCR. citeturn10search0  
- Tesseract’s LSTM engine is accurate but compute-heavy by design. citeturn2search9turn2search24  
- Manga/textured backgrounds remain difficult unless you implement region-first detection and deskew when needed (your Knowledge.md already points that way, and Tesseract docs strongly support deskew/segmentation correctness). citeturn3view1  

If you truly need “Snipping Tool-level” UX on Windows, the honest answer is: you should add an optional Windows-native OCR provider behind your abstraction. Snipping Tool’s OCR is local, and Windows offers local OCR surfaces explicitly. citeturn10search1turn10search0turn10search2  
But if you must stay Tesseract-only, the plan above is the fastest route to “feels instant most of the time” without turning `worker.ts` into an unmaintainable heuristic monster.

## Measurement and Guardrails

Given your existing debug payloads (stage metrics, dropped words, skipReason, runtime), you’re already set up for an evidence-based loop. What’s missing is the fixture pack and “fast path” KPI gates.

Minimum set of metrics to add (per page and per region):
- “time-to-first-text-layer” (panel fast pass)
- “final accuracy proxy” (confidence-weighted character count)
- ghost text rate (non-empty OCR in low-edge/no-text regions)
- cancellation success rate (how often abort avoids CPU burn)

And per Tesseract.js guidance, explicitly benchmark:
- cold start (no cache) vs warm start (language cached) citeturn11view0  
- stable session growth (memory + runtime drift), validating your periodic reset thresholds citeturn11view1  

If you want the single most important next repo improvement beyond pure speed: **add the real manga fixtures + saved debug payloads**, because it’s the only way to safely reduce heuristics while improving latency and stability (and it aligns with your Knowledge.md roadmap).