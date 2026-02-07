import { pdfjs } from 'react-pdf';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Ensure PDF.js uses a real worker (avoids fake worker + big perf hit)
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjs };
