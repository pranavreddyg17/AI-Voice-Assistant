"""Create a simple test PDF for upload testing."""
try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
except ImportError:
    print("Run: pip install reportlab")
    exit(1)

c = canvas.Canvas("test_policy.pdf", pagesize=letter)
c.setFont("Helvetica", 14)
c.drawString(100, 750, "Insurance Policy Document")
c.setFont("Helvetica", 12)
c.drawString(100, 720, "Policy Number: 12345")
c.drawString(100, 690, "Insured: John Smith")
c.drawString(100, 660, "Coverage: Hospital stay, emergency care")
c.drawString(100, 630, "Deductible: $500 per year")
c.drawString(100, 600, "Out-of-pocket maximum: $2,000")
c.drawString(100, 570, "Claims must be submitted within 90 days.")
c.drawString(100, 540, "Pre-authorization required for non-emergency hospital stays.")
c.save()
print("Created test_policy.pdf")
