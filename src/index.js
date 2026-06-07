const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const db = require('./config/db.js');
const authRoutes = require('./routes/auth.js');
const tracksRoutes = require('./routes/tracks.js');
const artistsRoutes = require('./routes/artists.js');
const albumsRoutes = require('./routes/albums.js');
const playlistsRoutes = require('./routes/playlists.js');
const likesRoutes = require('./routes/likes.js');
const historyRoutes = require('./routes/history.js');
const smartSearchRoutes = require('./routes/smartSearch');
const ytHealthRoutes = require('./routes/ytHealth');


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// routes
app.use('/api/auth', authRoutes);
app.use('/api/tracks', tracksRoutes);
app.use('/api/artists', artistsRoutes);
app.use('/api/albums', albumsRoutes);
app.use('/api/playlists', playlistsRoutes);
app.use('/api/likes', likesRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/smart-search', smartSearchRoutes);
app.use('/api/yt-health', ytHealthRoutes);


// Health check route
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'server is running'
    });
});

app.listen(PORT, () => {
    console.log(`server running on ${PORT}`);
});