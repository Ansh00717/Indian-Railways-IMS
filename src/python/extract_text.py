import sys
import os
import pdfplumber
from pdf2image import convert_from_path
import pytesseract
from PIL import Image

def extract_text(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext in ['.pdf']:
        text = ""
        # 1. Attempt pdfplumber
        try:
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        except Exception as e:
            pass
        
        # 2. If insufficient text, fallback to OCR
        if len(text.strip()) < 50:
            text = ""
            try:
                images = convert_from_path(file_path)
                for img in images:
                    text += pytesseract.image_to_string(img) + "\n"
            except Exception as e:
                print(f"Error during OCR: {e}", file=sys.stderr)
        return text
    elif ext in ['.jpg', '.jpeg', '.png']:
        try:
            img = Image.open(file_path)
            return pytesseract.image_to_string(img)
        except Exception as e:
            print(f"Error during Image OCR: {e}", file=sys.stderr)
            return ""
    else:
        print(f"Unsupported file extension: {ext}", file=sys.stderr)
        return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_text.py <file_path>", file=sys.stderr)
        sys.exit(1)
    file_path = sys.argv[1]
    extracted = extract_text(file_path)
    print(extracted)
