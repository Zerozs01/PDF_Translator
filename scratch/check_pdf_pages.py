import os
import sys

# ลอง import pypdf หรือ library PDF
try:
    import pypdf
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pypdf"])
    import pypdf

pdf_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\imports\f2f805ee8083892eba5afd0a.pdf"

print(f"Checking PDF: {pdf_path}")
if not os.path.exists(pdf_path):
    print("PDF file not found!")
    exit(1)

try:
    reader = pypdf.PdfReader(pdf_path)
    print(f"Actual PDF Page Count: {len(reader.pages)}")
except Exception as e:
    print(f"Error reading PDF: {e}")
