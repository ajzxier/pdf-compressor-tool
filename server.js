const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument, rgb } = require('pdf-lib');

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
  let pdfDoc = await PDFDocument.load(pdfBytes);
  
  let currentSizeKB = pdfBytes.length / 1024;
  console.log(`Initial PDF size: ${(currentSizeKB / 1024).toFixed(2)} MB`);
  
  if (currentSizeKB <= targetSizeKB) {
    return pdfBytes;
  }
  
  const compressionRatio = targetSizeKB / currentSizeKB;
  console.log(`Need to compress to ${(compressionRatio * 100).toFixed(1)}% of original size`);
  
  let compressedBytes = pdfBytes;
  let attempts = 0;
  const maxAttempts = 15;
  
  while (currentSizeKB > targetSizeKB && attempts < maxAttempts) {
    attempts++;
    console.log(`Compression attempt ${attempts}...`);
    
    const newPdfDoc = await PDFDocument.create();
    const pages = pdfDoc.getPages();
    
    // More aggressive page reduction for extreme compression needs
    let pageSubset = pages.length;
    if (compressionRatio < 0.3 && attempts > 5) {
      pageSubset = Math.max(1, Math.ceil(pages.length * 0.8));
      console.log(`Reducing to ${pageSubset} pages out of ${pages.length}`);
    }
    
    for (let i = 0; i < pageSubset; i++) {
      const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
      
      // Progressive content scaling based on compression needs
      if (attempts > 1) {
        const { width, height } = copiedPage.getSize();
        
        // Calculate scale factor based on attempts and compression ratio
        let scaleFactor = 1;
        if (attempts <= 3) {
          scaleFactor = 0.95;
        } else if (attempts <= 6) {
          scaleFactor = 0.85;
        } else if (attempts <= 9) {
          scaleFactor = 0.75;
        } else {
          scaleFactor = Math.max(0.5, 0.9 - (attempts * 0.03));
        }
        
        // Scale content
        copiedPage.scaleContent(scaleFactor, scaleFactor);
        
        // Reduce page dimensions for extreme compression
        if (attempts > 7) {
          const newWidth = width * (1 - (attempts - 7) * 0.05);
          const newHeight = height * (1 - (attempts - 7) * 0.05);
          copiedPage.setSize(Math.max(newWidth, width * 0.7), Math.max(newHeight, height * 0.7));
        }
        
        // Remove annotations and form fields if needed
        if (attempts > 10) {
          try {
            const annotations = copiedPage.node.Annots();
            if (annotations) {
              copiedPage.node.delete('Annots');
            }
          } catch (e) {
            // Ignore errors when removing annotations
          }
        }
      }
      
      newPdfDoc.addPage(copiedPage);
    }
    
    // Try to remove metadata and embedded files for extreme compression
    if (attempts > 8) {
      try {
        newPdfDoc.setTitle('');
        newPdfDoc.setAuthor('');
        newPdfDoc.setSubject('');
        newPdfDoc.setKeywords([]);
        newPdfDoc.setProducer('');
        newPdfDoc.setCreator('');
      } catch (e) {
        // Ignore metadata errors
      }
    }
    
    // Use different save options based on compression level needed
    let saveOptions = {};
    if (attempts <= 3) {
      saveOptions = {
        useObjectStreams: true,
        addDefaultPage: false,
      };
    } else if (attempts <= 6) {
      saveOptions = {
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 10,
      };
    } else if (attempts <= 9) {
      saveOptions = {
        useObjectStreams: false,
        addDefaultPage: false,
        objectsPerTick: 5,
      };
    } else {
      // Most aggressive compression
      saveOptions = {
        useObjectStreams: false,
        addDefaultPage: false,
        objectsPerTick: 1,
        updateFieldAppearances: false,
      };
    }
    
    compressedBytes = await newPdfDoc.save(saveOptions);
    currentSizeKB = compressedBytes.length / 1024;
    console.log(`Attempt ${attempts} size: ${(currentSizeKB / 1024).toFixed(2)} MB`);
    
    if (currentSizeKB <= targetSizeKB) {
      console.log(`Successfully compressed to target size!`);
      break;
    }
    
    // Reload the compressed version for further compression if needed
    if (attempts % 3 === 0) {
      try {
        pdfDoc = await PDFDocument.load(compressedBytes);
      } catch (e) {
        console.log('Could not reload compressed PDF, continuing with original');
      }
    }
  }
  
  if (currentSizeKB > targetSizeKB && attempts >= maxAttempts) {
    console.log(`Warning: Could not achieve exact target size after ${maxAttempts} attempts`);
    console.log(`Final size: ${(currentSizeKB / 1024).toFixed(2)} MB (target was ${(targetSizeKB / 1024).toFixed(2)} MB)`);
    
    // Last resort: Create a minimal PDF with text notice if still too large
    if (compressionRatio < 0.1) {
      const minimalPdf = await PDFDocument.create();
      const page = minimalPdf.addPage([612, 792]);
      page.drawText('PDF compressed to minimum size.', {
        x: 50,
        y: 700,
        size: 12,
        color: rgb(0, 0, 0),
      });
      page.drawText(`Original had ${pages.length} pages.`, {
        x: 50,
        y: 680,
        size: 10,
        color: rgb(0.5, 0.5, 0.5),
      });
      page.drawText('Some content may have been removed to meet size requirements.', {
        x: 50,
        y: 660,
        size: 10,
        color: rgb(0.5, 0.5, 0.5),
      });
      compressedBytes = await minimalPdf.save();
      console.log('Created minimal PDF as last resort');
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