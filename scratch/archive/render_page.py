import pypdfium2 as pdfium
import os

pdf_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\imports\8c59bcb19b14d506671413de.pdf"
doc = pdfium.PdfDocument(pdf_path)
page = doc[1] # page 2 (0-indexed index 1)
bitmap = page.render(scale=2.0)
pil_img = bitmap.to_pil()
os.makedirs("scratch", exist_ok=True)
pil_img.save("scratch/page2.png")
print("Saved scratch/page2.png")
