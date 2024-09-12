const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const sharp = require('sharp');
const axios = require('axios');
const BeeQueue = require('bee-queue');
const cors = require('cors');
// Initialize Express app
const app = express();

app.use(cors());
app.use(express.json());

// PostgreSQL setup
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
    port: 5432,
    ssl: {
        rejectUnauthorized: false,  // NeonDB typically requires SSL
      },
  });

// Setup Redis/Bull Queue for async processing
const imageQueue = new BeeQueue('image-processing', {
    redis: {
        host: '127.0.0.1', // Update with your Redis server details
        port: 6379,        // Default Redis port
    },
});

// Setup multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Helper function to compress images
async function compressImage(imageUrl) {
  const response = await axios({
    url: imageUrl,
    responseType: 'arraybuffer',
  });
  const buffer = Buffer.from(response.data, 'binary');
  const compressedBuffer = await sharp(buffer).jpeg({ quality: 50 }).toBuffer();
  const compressedFilePath = path.join(__dirname, 'output', `compressed-${Date.now()}.jpg`);
  fs.writeFileSync(compressedFilePath, compressedBuffer);
  console.log(compressedFilePath);
  return compressedFilePath;  // Save compressed file locally
}

// Process image data asynchronously
imageQueue.process(async (job, done) => {
  try{
  const { requestId, products } = job.data;

  for (let product of products) {
    const outputImageUrls = [];
    for (let url of product.inputImageUrls) {
      const compressedImagePath = await compressImage(url);
      outputImageUrls.push(compressedImagePath); // Replace with public URL if using S3
    console.log(outputImageUrls);
    }

    // Update database with processed image URLs
    await pool.query(
      'UPDATE products SET output_image_urls = $1, status = $2 WHERE request_id = $3 AND product_name = $4',
      [outputImageUrls.join(','), 'COMPLETED', requestId, product.productName]
    );
  }

  // Mark request as completed
  await pool.query('UPDATE requests SET status = $1 WHERE id = $2', ['COMPLETED', requestId]);
  done(null)
  }catch(error){
    console.error('Error processing job:', error);
    done(error); // Signal job failed
  }
  // Optional: Call webhook here if implemented
});
function isValidUrlList(urls) {
    const urlArray = urls.split(',');
    for (let url of urlArray) {
      if (!isValidUrl(url.trim())) {
        return false;
      }
    }
    return true;
  }
  
  // Helper function to validate a single URL
  function isValidUrl(url) {
    const urlPattern = new RegExp(
      '^(https?:\\/\\/)?' + // protocol
      '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.?)+[a-z]{2,}|' + // domain name
      '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
      '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
      '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
      '(\\#[-a-z\\d_]*)?$', 'i' // fragment locator
    );
    return !!urlPattern.test(url);
  }
// Upload API - Handles CSV upload
app.post('/upload', upload.single('file'), async (req, res) => {
    const requestId = Date.now().toString(); // Unique request ID
    const products = [];
    let isValid = true;
    let errorMessage = '';
    console.log(requestId);
    // Validate and parse CSV
    fs.createReadStream(req.file.path)
      .pipe(csvParser())
      .on('headers', (headers) => {
        // Check if the CSV has the correct columns
        if (!headers.includes('S. No.') || 
            !headers.includes('Product Name') || 
            !headers.includes('Input Image Urls')) {
          isValid = false;
          errorMessage = 'Invalid CSV format: Missing required columns (S. No., Product Name, Input Image Urls).';
        }
      })
      .on('data', (row) => {
        // If headers are valid, validate row data
        if (isValid) {
          // Validate that each field has a value
          if (!row['S. No.'] || !row['Product Name'] || !row['Input Image Urls']) {
            isValid = false;
            errorMessage = 'Invalid row format: Missing data in one or more required fields.';
          }
  
          // Validate that Input Image Urls contains valid URLs
          if (!isValidUrlList(row['Input Image Urls'])) {
            isValid = false;
            errorMessage = 'Invalid input: One or more image URLs are not valid.';
          } else {
            const inputImageUrls = row['Input Image Urls'].split(',');
            products.push({
              serialNumber: row['S. No.'],
              productName: row['Product Name'],
              inputImageUrls,
            });
          }
        }
      })
      .on('end', async () => {
        if (!isValid) {
          return res.status(400).json({ error: errorMessage });
        }
  
        // Insert request and product data into the database
        await pool.query('INSERT INTO requests (id, status) VALUES ($1, $2)', [requestId, 'PENDING']);
  
        for (let product of products) {
          await pool.query(
            'INSERT INTO products (request_id, product_name, input_image_urls, status) VALUES ($1, $2, $3, $4)',
            [requestId, product.productName, product.inputImageUrls.join(','), 'PENDING']
          );
        }
  
        // Add the job to the Bull queue for processing
       imageQueue.createJob({ requestId, products }).save();
  
        // Respond with the request ID
        res.json({ requestId });
      });
  });
  
  // Helper function to validate a comma-separated list of URLs

  

// Status API - Check the status of image processing
app.get('/status/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const result = await pool.query('SELECT status FROM requests WHERE id = $1', [requestId]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Request ID not found' });
  }

  res.json({ status: result.rows[0].status });
});

// Start the server
app.listen(3001, () => {
  console.log('Server started on port 3001');
});
