const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

async function compressPDF(pdfBytes, targetSizeKB) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  
  let compressedBytes = await pdfDoc.save();
  let currentSizeKB = compressedBytes.length / 1024;
  
  if (currentSizeKB <= targetSizeKB) {
    return compressedBytes;
  }
  
  let quality = 0.9;
  while (currentSizeKB > targetSizeKB && quality > 0.1) {
    const newPdfDoc = await PDFDocument.create();
    
    for (const page of pages) {
      const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pages.indexOf(page)]);
      newPdfDoc.addPage(copiedPage);
    }
    
    compressedBytes = await newPdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      objectsPerTick: 50,
      updateFieldAppearances: false,
    });
    
    currentSizeKB = compressedBytes.length / 1024;
    quality -= 0.1;
    
    if (currentSizeKB <= targetSizeKB) {
      break;
    }
  }
  
  return compressedBytes;
}

async function mergePDFs(pdfBuffers) {
  const mergedPdf = await PDFDocument.create();
  
  for (const pdfBuffer of pdfBuffers) {
    const pdf = await PDFDocument.load(pdfBuffer);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }
  
  return await mergedPdf.save();
}

app.post('/api/merge-compress', upload.array('pdfs', 20), async (req, res) => {
  try {
    const targetSizeMB = parseFloat(req.body.targetSize) || 9;
    const targetSizeKB = targetSizeMB * 1024;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }
    
    const pdfBuffers = req.files.map(file => file.buffer);
    
    console.log(`Merging ${pdfBuffers.length} PDFs...`);
    const mergedPdf = await mergePDFs(pdfBuffers);
    
    const mergedSizeKB = mergedPdf.length / 1024;
    console.log(`Merged PDF size: ${(mergedSizeKB / 1024).toFixed(2)} MB`);
    
    let finalPdf = mergedPdf;
    if (mergedSizeKB > targetSizeKB) {
      console.log(`Compressing to target size: ${targetSizeMB} MB...`);
      finalPdf = await compressPDF(mergedPdf, targetSizeKB);
      console.log(`Final PDF size: ${(finalPdf.length / 1024 / 1024).toFixed(2)} MB`);
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged-compressed.pdf"');
    res.send(Buffer.from(finalPdf));
    
  } catch (error) {
    console.error('Error processing PDFs:', error);
    res.status(500).json({ error: 'Failed to process PDFs: ' + error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});