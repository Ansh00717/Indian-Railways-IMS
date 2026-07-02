"""
PyMuPDF-based PDF text extractor for RDSO Receipt Notes.

Usage:
    python pymupdf_extract.py <file_path>

Outputs extracted text to stdout.
Exit code 0 = success, 1 = failure/no text.
"""
import sys
import os

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF not installed", file=sys.stderr)
    sys.exit(1)


def extract_text_pymupdf(file_path: str) -> str:
    """
    Extract text from a PDF using PyMuPDF (fitz).
    
    PyMuPDF is superior to pdf-parse for digital PDFs because it:
    - Preserves layout and reading order better
    - Handles complex table structures common in Railway receipt notes
    - Extracts text from form fields and annotations
    - Handles Unicode and special characters more reliably
    """
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    ext = os.path.splitext(file_path)[1].lower()
    if ext != '.pdf':
        print(f"Not a PDF file: {ext}", file=sys.stderr)
        sys.exit(1)

    try:
        doc = fitz.open(file_path)
    except Exception as e:
        print(f"Failed to open PDF: {e}", file=sys.stderr)
        sys.exit(1)

    text_parts = []

    for page_num in range(len(doc)):
        page = doc[page_num]

        # Primary: extract text preserving layout
        # "text" sort mode gives natural reading order
        page_text = page.get_text("text", sort=True)

        if page_text and page_text.strip():
            text_parts.append(page_text.strip())
        else:
            # Fallback: try "blocks" mode for pages with complex layouts
            blocks = page.get_text("blocks", sort=True)
            block_texts = []
            for block in blocks:
                # block[4] is the text content, block[6] is the block type (0=text)
                if block[6] == 0 and block[4].strip():
                    block_texts.append(block[4].strip())
            if block_texts:
                text_parts.append("\n".join(block_texts))

    doc.close()

    full_text = "\n\n".join(text_parts)
    return full_text.strip()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pymupdf_extract.py <file_path>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    extracted = extract_text_pymupdf(file_path)

    if not extracted or len(extracted.strip()) < 10:
        # Signal that extraction produced insufficient text
        print(extracted, end="")
        sys.exit(1)

    print(extracted, end="")
    sys.exit(0)
