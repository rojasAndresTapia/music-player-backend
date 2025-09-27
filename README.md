# Music Backend API

Express.js backend API for streaming music from AWS S3 with album artwork support and audio proxying.

## 🎵 Features

- **📁 Album Discovery**: Automatically scans and organizes music from S3 bucket
- **🎶 Audio Streaming**: Serves audio files through proxy for secure streaming
- **🖼️ Image Proxy**: Serves album artwork with proper caching headers
- **🔄 Smart Caching**: Folder mapping cache to optimize S3 requests
- **🌐 CORS Support**: Configured for frontend integration
- **⚡ Fast Response**: Optimized with caching and efficient S3 operations

## 🏗️ Architecture

### S3 Bucket Structure
```
your-bucket/
└── albums/
    ├── Artist1 - Album1/
    │   ├── 01 - Song1.mp3
    │   ├── 02 - Song2.mp3
    │   └── album-artwork.jpg
    └── Artist2 - Album2/
        ├── 01 - Song1.mp3
        └── folder.jpg
```

### API Endpoints

#### `GET /albums`
Returns organized album structure grouped by artist and album.

**Response:**
```json
{
  "Artist Name": {
    "Album Name": {
      "tracks": ["01 - Song.mp3", "02 - Song.mp3"],
      "images": ["album-cover.jpg"],
      "originalFolder": "Artist Name - Album Name"
    }
  }
}
```

#### `GET /audio-proxy?key=Artist/Album/Song.mp3`
Streams audio files directly from S3 through the backend proxy.

**Headers:**
- `Content-Type: audio/mp3`
- `Accept-Ranges: bytes`
- `Cache-Control: public, max-age=31536000`

#### `GET /image-proxy?key=Artist/Album/image.jpg`
Serves album artwork directly from S3 through the backend proxy.

**Headers:**
- `Content-Type: image/jpeg`
- `Cache-Control: public, max-age=31536000`

#### `GET /song?key=Artist/Album/Song.mp3` *(Legacy)*
Generates signed URLs for audio files (fallback endpoint).

#### `GET /image?key=Artist/Album/image.jpg` *(Legacy)*
Generates signed URLs for images (fallback endpoint).

## 🚀 Quick Start

### Prerequisites
- Node.js 14.0.0 or higher
- AWS account with S3 bucket
- AWS IAM user with S3 read permissions

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd music-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp env-template.txt .env
   # Edit .env with your AWS credentials
   ```

4. **Start the server**
   ```bash
   npm run dev
   ```

Server will start on `http://localhost:4000`

## ⚙️ Configuration

### Environment Variables

Create a `.env` file based on `env-template.txt`:

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key ID | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Access Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `AWS_REGION` | AWS Region where your S3 bucket is located | `us-east-1` |
| `AWS_BUCKET_NAME` | Name of your S3 bucket containing music | `my-music-bucket` |
| `PORT` | Port for the server to run on | `4000` |

### AWS Setup

1. **Create S3 Bucket**: Store your music files in the required structure
2. **Create IAM User**: With programmatic access
3. **Attach Policy**: Grant S3 read permissions for your music bucket
4. **Get Credentials**: Use Access Key ID and Secret Access Key in `.env`

### Required AWS Permissions

Your IAM user needs these permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

## 🔧 API Usage Examples

### Get All Albums
```bash
curl http://localhost:4000/albums
```

### Stream Audio File
```bash
curl http://localhost:4000/audio-proxy?key=Artist/Album/Song.mp3
```

### Get Album Artwork
```bash
curl http://localhost:4000/image-proxy?key=Artist/Album/cover.jpg
```

## 🎯 Performance Features

- **📦 Folder Mapping Cache**: 5-minute cache for S3 folder structure
- **🚀 Proxy Streaming**: Direct S3 streaming through backend
- **⚡ Optimized Requests**: Minimal S3 API calls with intelligent caching
- **🔄 Error Handling**: Graceful handling of missing files and network issues

## 🛠️ Development

### Project Structure
```
music-backend/
├── index.js              # Main server file
├── package.json          # Dependencies and scripts
├── .env                  # Environment variables (not in git)
├── env-template.txt      # Environment template
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

### Adding New Features

The server is built with Express.js and uses:
- **AWS SDK v2** for S3 operations
- **CORS** for cross-origin requests
- **dotenv** for environment configuration

### Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server
- `npm test` - Run tests (not implemented yet)

## 🔗 Frontend Integration

This backend is designed to work with the Music Player frontend. The frontend should:

1. **Set API URL**: Point to `http://localhost:4000` (or your deployed URL)
2. **Configure Next.js**: Add backend domain to `remotePatterns` for images
3. **Use Proxy Endpoints**: Use `/audio-proxy` and `/image-proxy` for streaming

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 🐛 Troubleshooting

### Common Issues

**Server won't start:**
- Check if `.env` file exists and has correct AWS credentials
- Verify AWS permissions for S3 bucket access

**No albums returned:**
- Verify S3 bucket structure follows `albums/Artist - Album/Song.mp3` format
- Check AWS credentials have ListBucket permissions

**Audio/Images won't load:**
- Verify AWS credentials have GetObject permissions
- Check if files exist in S3 bucket
- Ensure CORS is properly configured

### Debug Mode

Add debug logging by setting:
```javascript
console.log('Debug info:', data);
```

## 📊 API Response Examples

### Albums Endpoint Response
```json
{
  "Radiohead": {
    "OK Computer": {
      "tracks": [
        "01 - Airbag.mp3",
        "02 - Paranoid Android.mp3"
      ],
      "images": ["folder.jpg"],
      "originalFolder": "Radiohead - OK Computer"
    }
  }
}
```

### Audio Proxy Response
- **Content-Type**: `audio/mp3`
- **Content-Length**: File size in bytes
- **Body**: Raw audio data stream

### Image Proxy Response
- **Content-Type**: `image/jpeg`
- **Content-Length**: File size in bytes  
- **Body**: Raw image data
