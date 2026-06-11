import pypdfium2 as pdfium
import sys

sys.stdout.reconfigure(encoding='utf-8')
pdf_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\imports\6f98100b27450dbfcac939ec.pdf"
doc = pdfium.PdfDocument(pdf_path)
print("Total pages:", len(doc))
for idx, page in enumerate(doc):
    size = page.get_size()
    aspect = size[1] / max(1, size[0])
    print(f"Page {idx+1}: size={size} aspect_ratio={aspect:.2f}")
doc.close()
