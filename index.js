/**
 * Music Backend API
 * 
 * Express.js server that provides music streaming from AWS S3
 * Features:
 * - Album discovery and organization
 * - Audio streaming proxy
 * - Image proxy for album artwork
 * - Folder mapping cache for performance
 * 
 * @author Andres Rojas
 * @version 1.0.0
 */

require("dotenv").config();
const express = require("express");
const AWS = require("aws-sdk");
const cors = require("cors");

const app = express();

// Enable CORS for frontend integration
app.use(cors());

// Configure AWS S3 client
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Ruta: listar archivos en el bucket
app.get("/albums", async (req, res) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: "albums/", // Only look in the albums folder
    };

    const data = await s3.listObjectsV2(params).promise();

    // Organizar resultados en estructura: artista > album > canciones
    const library = {};
    const folderMappings = {}; // Store original folder names

    data.Contents.forEach((file) => {
      const parts = file.Key.split("/"); // [albums, Artist - Album, Song.mp3]
      if (parts.length === 3 && parts[0] === "albums") {
        const [, artistAlbum, song] = parts; // Skip the "albums" prefix
        
        // Skip folder entries and playlist files, but allow music and image files
        if (song && song.includes('.') && !song.includes('.m3u')) {
          // Parse "Artist - Album" format
          let dashIndex = artistAlbum.lastIndexOf(' - ');
          let artist, album;
          
          if (dashIndex > 0) {
            artist = artistAlbum.substring(0, dashIndex).trim();
            album = artistAlbum.substring(dashIndex + 3).trim();
          } else {
            // Try with just "-" (without spaces)
            dashIndex = artistAlbum.lastIndexOf('-');
            if (dashIndex > 0) {
              artist = artistAlbum.substring(0, dashIndex).trim();
              album = artistAlbum.substring(dashIndex + 1).trim();
            } else {
              // Fallback: use the whole string as both artist and album
              artist = artistAlbum.trim();
              album = artistAlbum.trim();
            }
          }
          
          // Store the original folder name for this artist/album combination
          const key = `${artist}|${album}`;
          if (!folderMappings[key]) {
            folderMappings[key] = artistAlbum;
          }
          
          if (!library[artist]) library[artist] = {};
          if (!library[artist][album]) library[artist][album] = {};
          if (!library[artist][album].tracks) library[artist][album].tracks = [];
          if (!library[artist][album].images) library[artist][album].images = [];
          if (!library[artist][album].originalFolder) library[artist][album].originalFolder = artistAlbum;
          
          // Separate music files from image files
          if (song.match(/\.(mp3|wav|flac|m4a|ogg)$/i)) {
            library[artist][album].tracks.push(song);
          } else if (song.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            library[artist][album].images.push(song);
          }
        }
      }
    });

    res.json(library);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error listando archivos" });
  }
});

/**
 * Folder Mapping Cache System
 * 
 * Caches S3 folder structure to avoid repeated expensive S3 scans
 * In production, consider using Redis or database for distributed caching
 */
let globalFolderMappings = {};
let mappingsLastUpdated = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

// Helper function to get or refresh folder mappings
const getFolderMappings = async () => {
  const now = Date.now();
  if (now - mappingsLastUpdated > CACHE_DURATION || Object.keys(globalFolderMappings).length === 0) {
    console.log('Refreshing folder mappings cache...');
    
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: "albums/",
    };

    const data = await s3.listObjectsV2(params).promise();
    const folderMappings = {};

    // Rebuild folder mappings
    data.Contents.forEach((file) => {
      const parts = file.Key.split("/");
      if (parts.length === 3 && parts[0] === "albums") {
        const [, artistAlbum, song] = parts;
        if (song && song.includes('.') && !song.includes('.m3u')) {
          let dashIndex = artistAlbum.lastIndexOf(' - ');
          let artist, album;
          
          if (dashIndex > 0) {
            artist = artistAlbum.substring(0, dashIndex).trim();
            album = artistAlbum.substring(dashIndex + 3).trim();
          } else {
            dashIndex = artistAlbum.lastIndexOf('-');
            if (dashIndex > 0) {
              artist = artistAlbum.substring(0, dashIndex).trim();
              album = artistAlbum.substring(dashIndex + 1).trim();
            } else {
              artist = artistAlbum.trim();
              album = artistAlbum.trim();
            }
          }
          
          const mappingKey = `${artist}|${album}`;
          if (!folderMappings[mappingKey]) {
            folderMappings[mappingKey] = artistAlbum;
          }
        }
      }
    });
    
    globalFolderMappings = folderMappings;
    mappingsLastUpdated = now;
    console.log('Folder mappings cache updated');
  }
  
  return globalFolderMappings;
};

// Ruta: servir imágenes directamente como proxy
app.get("/image-proxy", async (req, res) => {
  try {
    const { key } = req.query; // Ej: Artist/Album/folder.jpg
    
    // Get cached folder mappings
    const folderMappings = await getFolderMappings();
    
    // Convert Artist/Album/Image.jpg using the original folder name
    const keyParts = key.split('/');
    let fullKey;
    
    if (keyParts.length === 3) {
      const [artist, album, image] = keyParts;
      const mappingKey = `${artist}|${album}`;
      const originalFolder = folderMappings[mappingKey];
      
      if (originalFolder) {
        fullKey = `albums/${originalFolder}/${image}`;
      } else {
        fullKey = `albums/${artist} - ${album}/${image}`;
      }
    } else {
      fullKey = key.startsWith('albums/') ? key : `albums/${key}`;
    }

    // Get the image data directly from S3
    const imageParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fullKey,
    };

    const imageData = await s3.getObject(imageParams).promise();
    
    // Set appropriate headers
    res.setHeader('Content-Type', imageData.ContentType || 'image/jpeg');
    res.setHeader('Content-Length', imageData.ContentLength);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    // Send the image data
    res.send(imageData.Body);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: "Image not found" });
  }
});

// Ruta: generar URL temporal para una imagen de álbum (fallback)
app.get("/image", async (req, res) => {
  try {
    const { key } = req.query; // Ej: Artist/Album/folder.jpg
    
    // We need to get the album data first to find the original folder name
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: "albums/",
    };

    const data = await s3.listObjectsV2(params).promise();
    const folderMappings = {};

    // Rebuild folder mappings
    data.Contents.forEach((file) => {
      const parts = file.Key.split("/");
      if (parts.length === 3 && parts[0] === "albums") {
        const [, artistAlbum, song] = parts;
        if (song && song.includes('.') && !song.includes('.m3u')) {
          let dashIndex = artistAlbum.lastIndexOf(' - ');
          let artist, album;
          
          if (dashIndex > 0) {
            artist = artistAlbum.substring(0, dashIndex).trim();
            album = artistAlbum.substring(dashIndex + 3).trim();
          } else {
            dashIndex = artistAlbum.lastIndexOf('-');
            if (dashIndex > 0) {
              artist = artistAlbum.substring(0, dashIndex).trim();
              album = artistAlbum.substring(dashIndex + 1).trim();
            } else {
              artist = artistAlbum.trim();
              album = artistAlbum.trim();
            }
          }
          
          const mappingKey = `${artist}|${album}`;
          if (!folderMappings[mappingKey]) {
            folderMappings[mappingKey] = artistAlbum;
          }
        }
      }
    });
    
    // Convert Artist/Album/Image.jpg using the original folder name
    const keyParts = key.split('/');
    let fullKey;
    
    if (keyParts.length === 3) {
      const [artist, album, image] = keyParts;
      const mappingKey = `${artist}|${album}`;
      const originalFolder = folderMappings[mappingKey];
      
      if (originalFolder) {
        fullKey = `albums/${originalFolder}/${image}`;
      } else {
        // Fallback to constructed path
        fullKey = `albums/${artist} - ${album}/${image}`;
      }
    } else {
      // Fallback: assume it's already in the correct format
      fullKey = key.startsWith('albums/') ? key : `albums/${key}`;
    }

    const signParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fullKey,
      Expires: 3600, // URL válida 1 hora
    };

    const url = s3.getSignedUrl("getObject", signParams);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando URL de imagen" });
  }
});

// Ruta: servir audio directamente como proxy
app.get("/audio-proxy", async (req, res) => {
  try {
    const { key } = req.query; // Ej: Artist/Album/01 - Song.mp3
    
    // Get cached folder mappings
    const folderMappings = await getFolderMappings();
    
    // Convert Artist/Album/Song.mp3 using the original folder name
    const keyParts = key.split('/');
    let fullKey;
    
    if (keyParts.length === 3) {
      const [artist, album, song] = keyParts;
      const mappingKey = `${artist}|${album}`;
      const originalFolder = folderMappings[mappingKey];
      
      if (originalFolder) {
        fullKey = `albums/${originalFolder}/${song}`;
      } else {
        fullKey = `albums/${artist} - ${album}/${song}`;
      }
    } else {
      fullKey = key.startsWith('albums/') ? key : `albums/${key}`;
    }

    // Get the audio data directly from S3
    const audioParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fullKey,
    };

    const audioData = await s3.getObject(audioParams).promise();
    
    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', audioData.ContentType || 'audio/mpeg');
    res.setHeader('Content-Length', audioData.ContentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    // Send the audio data
    res.send(audioData.Body);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: "Audio not found" });
  }
});

// Ruta: generar URL temporal para una canción (fallback)
app.get("/song", async (req, res) => {
  try {
    const { key } = req.query; // Ej: Artist/Album/01 - Song.mp3
    
    // Get cached folder mappings
    const folderMappings = await getFolderMappings();
    
    // Convert Artist/Album/Song.mp3 using the original folder name
    const keyParts = key.split('/');
    let fullKey;
    
    if (keyParts.length === 3) {
      const [artist, album, song] = keyParts;
      const mappingKey = `${artist}|${album}`;
      const originalFolder = folderMappings[mappingKey];
      
      if (originalFolder) {
        fullKey = `albums/${originalFolder}/${song}`;
      } else {
        // Fallback to constructed path
        fullKey = `albums/${artist} - ${album}/${song}`;
      }
    } else {
      // Fallback: assume it's already in the correct format
      fullKey = key.startsWith('albums/') ? key : `albums/${key}`;
    }

    const signParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fullKey,
      Expires: 3600, // URL válida 1 hora
    };

    const url = s3.getSignedUrl("getObject", signParams);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando URL" });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});