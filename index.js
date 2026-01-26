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

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// Simple test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Backend is working!', timestamp: new Date().toISOString() });
});

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
      MaxKeys: 1000, // Maximum keys per page
    };

    // Organizar resultados en estructura: artista > album > canciones
    const library = {};
    const folderMappings = {}; // Store original folder names
    
    // Handle pagination - fetch all pages
    let continuationToken = undefined;
    let allContents = [];
    
    do {
      const requestParams = { ...params };
      if (continuationToken) {
        requestParams.ContinuationToken = continuationToken;
      }
      
      const data = await s3.listObjectsV2(requestParams).promise();
      
      if (data.Contents) {
        allContents = allContents.concat(data.Contents);
      }
      
      continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
      console.log(`📦 Fetched ${allContents.length} objects so far...`);
    } while (continuationToken);
    
    console.log(`✅ Total objects fetched: ${allContents.length}`);

    allContents.forEach((file) => {
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

    // Count total albums
    let totalAlbums = 0;
    Object.keys(library).forEach(artist => {
      totalAlbums += Object.keys(library[artist]).length;
    });
    
    console.log(`🎵 Found ${Object.keys(library).length} artists with ${totalAlbums} total albums`);

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
      MaxKeys: 1000, // Maximum keys per page
    };

    const folderMappings = {};
    
    // Handle pagination - fetch all pages (same as /albums endpoint)
    let continuationToken = undefined;
    let allContents = [];
    
    do {
      const requestParams = { ...params };
      if (continuationToken) {
        requestParams.ContinuationToken = continuationToken;
      }
      
      const data = await s3.listObjectsV2(requestParams).promise();
      
      if (data.Contents) {
        allContents = allContents.concat(data.Contents);
      }
      
      continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
      console.log(`📦 [FOLDER-MAPPINGS] Fetched ${allContents.length} objects so far...`);
    } while (continuationToken);
    
    console.log(`✅ [FOLDER-MAPPINGS] Total objects fetched: ${allContents.length}`);

    // Rebuild folder mappings from all pages
    allContents.forEach((file) => {
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
    console.log(`✅ [FOLDER-MAPPINGS] Cache updated with ${Object.keys(folderMappings).length} unique artist|album mappings`);
  }
  
  return globalFolderMappings;
};

// Endpoint to manually clear folder mappings cache (for debugging/testing)
app.get("/clear-cache", async (req, res) => {
  globalFolderMappings = {};
  mappingsLastUpdated = 0;
  console.log('🗑️ [CACHE] Folder mappings cache cleared manually');
  res.json({ 
    message: 'Cache cleared successfully',
    timestamp: new Date().toISOString()
  });
});

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
    
    console.log(`🎵 [AUDIO-PROXY] Request for key: ${key}`);
    
    // Get cached folder mappings
    const folderMappings = await getFolderMappings();
    
    // Convert Artist/Album/Song.mp3 using the original folder name
    const keyParts = key.split('/');
    let fullKey;
    
    if (keyParts.length === 3) {
      const [artist, album, song] = keyParts;
      const mappingKey = `${artist}|${album}`;
      const originalFolder = folderMappings[mappingKey];
      
      console.log(`🔍 [AUDIO-PROXY] Looking up mapping: "${mappingKey}"`);
      console.log(`📁 [AUDIO-PROXY] Found original folder: ${originalFolder || 'NOT FOUND'}`);
      
      // Debug: Log all available mappings for this artist if not found
      if (!originalFolder) {
        const artistMappings = Object.entries(folderMappings).filter(([key]) => {
          const [mappedArtist] = key.split('|');
          return mappedArtist.toLowerCase() === artist.toLowerCase();
        });
        if (artistMappings.length > 0) {
          console.log(`🔍 [AUDIO-PROXY] Available mappings for artist "${artist}":`, 
            artistMappings.map(([key, folder]) => `  ${key} -> ${folder}`).join('\n'));
        } else {
          console.log(`⚠️ [AUDIO-PROXY] No mappings found for artist "${artist}"`);
          console.log(`📋 [AUDIO-PROXY] Total mappings in cache: ${Object.keys(folderMappings).length}`);
        }
      }
      
      if (originalFolder) {
        fullKey = `albums/${originalFolder}/${song}`;
      } else {
        // Try to find a folder that matches both artist and album (case-insensitive)
        // Priority: exact match > partial album match > artist-only match
        const exactMatches = Object.entries(folderMappings).filter(([mappingKey, folder]) => {
          const [mappedArtist, mappedAlbum] = mappingKey.split('|');
          return mappedArtist.toLowerCase() === artist.toLowerCase() && 
                 mappedAlbum.toLowerCase() === album.toLowerCase();
        });
        
        const partialAlbumMatches = Object.entries(folderMappings).filter(([mappingKey, folder]) => {
          const [mappedArtist, mappedAlbum] = mappingKey.split('|');
          return mappedArtist.toLowerCase() === artist.toLowerCase() && 
                 (mappedAlbum.toLowerCase().includes(album.toLowerCase()) || 
                  album.toLowerCase().includes(mappedAlbum.toLowerCase()));
        });
        
        const artistOnlyMatches = Object.entries(folderMappings).filter(([mappingKey, folder]) => {
          const [mappedArtist, mappedAlbum] = mappingKey.split('|');
          return mappedArtist.toLowerCase() === artist.toLowerCase() || 
                 folder.toLowerCase().includes(artist.toLowerCase());
        });
        
        // Use the best match available
        let matchedFolder = null;
        if (exactMatches.length > 0) {
          matchedFolder = exactMatches[0][1];
          console.log(`✅ [AUDIO-PROXY] Found exact match folder: ${matchedFolder}`);
        } else if (partialAlbumMatches.length > 0) {
          matchedFolder = partialAlbumMatches[0][1];
          console.log(`✅ [AUDIO-PROXY] Found partial album match folder: ${matchedFolder}`);
        } else if (artistOnlyMatches.length > 0) {
          matchedFolder = artistOnlyMatches[0][1];
          console.log(`⚠️ [AUDIO-PROXY] Found artist-only match folder: ${matchedFolder} (may be wrong album)`);
        }
        
        if (matchedFolder) {
          fullKey = `albums/${matchedFolder}/${song}`;
        } else {
          // Fallback strategies in order of likelihood
          if (artist === album) {
            // If artist and album are the same, try multiple formats
            // First try just the artist name (most common for self-titled albums)
            fullKey = `albums/${artist}/${song}`;
            console.log(`⚠️ [AUDIO-PROXY] No mapping found for artist===album, trying simple artist folder: ${fullKey}`);
          } else {
            // Try the constructed path "Artist - Album"
            fullKey = `albums/${artist} - ${album}/${song}`;
            console.log(`⚠️ [AUDIO-PROXY] No mapping found, using constructed path: ${fullKey}`);
          }
        }
      }
    } else {
      fullKey = key.startsWith('albums/') ? key : `albums/${key}`;
      console.log(`⚠️ [AUDIO-PROXY] Invalid key format, using: ${fullKey}`);
    }

    console.log(`🎯 [AUDIO-PROXY] Initial S3 key: ${fullKey}`);

    // Build list of paths to try (primary + fallbacks)
    const pathsToTry = [fullKey];
    
    // Add fallback paths if we're using a constructed path
    if (keyParts.length === 3) {
      const [artist, album, song] = keyParts;
      
      if (artist === album) {
        // Special handling for self-titled albums (artist === album)
        // Try multiple folder name formats
        if (!fullKey.includes(`${artist}/${song}`)) {
          pathsToTry.push(`albums/${artist}/${song}`);
        }
        if (!fullKey.includes(`${artist} - ${album}`)) {
          pathsToTry.push(`albums/${artist} - ${album}/${song}`);
        }
        // Also try with just a dash (no spaces)
        if (!fullKey.includes(`${artist}-${album}`)) {
          pathsToTry.push(`albums/${artist}-${album}/${song}`);
        }
      } else {
        // For different artist/album names, try constructed path
        if (!fullKey.includes(`${artist} - ${album}`)) {
          pathsToTry.push(`albums/${artist} - ${album}/${song}`);
        }
        // Also try with just a dash (no spaces)
        if (!fullKey.includes(`${artist}-${album}`)) {
          pathsToTry.push(`albums/${artist}-${album}/${song}`);
        }
      }
    }

    console.log(`🔍 [AUDIO-PROXY] Will try ${pathsToTry.length} path(s):`, pathsToTry);

    // Support HTTP Range requests for proper audio streaming
    const range = req.headers.range;
    
    // Try each path until one works
    let audioData = null;
    let actualKey = null;
    let lastError = null;
    
    for (const testKey of pathsToTry) {
      try {
        const testParams = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: testKey,
        };
        
        if (range) {
          // Get file metadata first to determine size
          const headParams = { ...testParams };
          const headData = await s3.headObject(headParams).promise();
          const fileSize = headData.ContentLength;
          
          // Parse range header (e.g., "bytes=0-1023")
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;
          
          // Get the requested chunk from S3
          const getParams = {
            ...testParams,
            Range: `bytes=${start}-${end}`
          };
          
          audioData = await s3.getObject(getParams).promise();
          actualKey = testKey;
          
          // Set headers for partial content
          res.status(206); // Partial Content
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', chunkSize);
          res.setHeader('Content-Type', audioData.ContentType || 'audio/mpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          
          console.log(`✅ [AUDIO-PROXY] Successfully loaded from: ${actualKey}`);
          res.send(audioData.Body);
          return;
        } else {
          // No range request - send full file (for compatibility)
          audioData = await s3.getObject(testParams).promise();
          actualKey = testKey;
          
          // Set appropriate headers for audio streaming
          res.setHeader('Content-Type', audioData.ContentType || 'audio/mpeg');
          res.setHeader('Content-Length', audioData.ContentLength);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
          
          console.log(`✅ [AUDIO-PROXY] Successfully loaded from: ${actualKey}`);
          res.send(audioData.Body);
          return;
        }
      } catch (testError) {
        console.log(`⚠️ [AUDIO-PROXY] Path failed: ${testKey} - ${testError.code || testError.message}`);
        lastError = testError;
        continue; // Try next path
      }
    }
    
    // If we get here, all paths failed
    throw lastError || new Error('All file paths failed');
  } catch (err) {
    console.error('❌ [AUDIO-PROXY] Error:', {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      key: req.query.key,
      stack: err.stack
    });
    
    // Provide more detailed error information
    if (err.code === 'NoSuchKey' || err.statusCode === 404) {
      res.status(404).json({ 
        error: "Audio not found",
        requestedKey: req.query.key,
        message: `File not found in S3 bucket. Check if the file exists at the expected path.`
      });
    } else {
      res.status(500).json({ 
        error: "Internal server error",
        message: err.message 
      });
    }
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

const PORT = process.env.PORT || 4000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`También disponible en http://192.168.1.159:${PORT}`);
});