"""PDF document parsing and chunking for insurance policies."""
import pdfplumber
from pathlib import Path
from typing import List
import re


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract all text from a PDF file."""
    text_parts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n\n".join(text_parts)


def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> List[str]:
    """
    Split text into overlapping chunks.
    Uses token approximation: ~4 chars per token.
    """
    if not text or not text.strip():
        return []
    
    # Clean and normalize
    text = re.sub(r"\s+", " ", text).strip()
    words = text.split()
    
    chunks = []
    current_chunk = []
    current_size = 0
    target_size = chunk_size * 4  # ~4 chars per token
    
    for word in words:
        word_len = len(word) + 1  # +1 for space
        if current_size + word_len > target_size and current_chunk:
            chunk_text = " ".join(current_chunk)
            chunks.append(chunk_text)
            
            # Overlap: keep last N words
            overlap_words = overlap * 4 // 5  # rough word count for overlap
            current_chunk = current_chunk[-overlap_words:] if overlap_words > 0 else []
            current_size = sum(len(w) + 1 for w in current_chunk)
        
        current_chunk.append(word)
        current_size += word_len
    
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    
    return chunks
