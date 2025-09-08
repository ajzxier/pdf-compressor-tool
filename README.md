# PDF Merger & Compressor Tool

A web-based tool that allows users to merge multiple PDF files and compress them to a target file size.

## Features

- Upload multiple PDF files via drag-and-drop or file browser
- Reorder PDFs before merging
- Set target maximum file size (in MB)
- Automatic compression to meet size requirements
- Download merged and compressed PDF

## Technology Stack

- Node.js + Express backend
- pdf-lib for PDF manipulation
- Vanilla JavaScript frontend
- Docker for containerization
- Railway for deployment

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open browser to http://localhost:3000

## Deployment

This application is configured for deployment on Railway with automatic builds from GitHub.

## Environment Variables

- `PORT` - Server port (default: 3000)

## License

MIT