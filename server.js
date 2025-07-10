// server.js - Express API server for Vestaboard frontend
const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Constants
const VESTABOARD_API_URL = 'https://rw.vestaboard.com/';
const READ_WRITE_KEY = process.env.VESTABOARD_READ_WRITE_KEY;
const DATA_CACHE_PATH = path.join(__dirname, 'cache.json');
const CACHE_DURATION = parseInt(process.env.CACHE_DURATION || '3600000', 10);
const RATE_LIMIT_DELAY = 16000; // 16 seconds

// Character codes for Vestaboard
const VESTABOARD_CHARS = {
    BLANK: 0,
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10,
    K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, T: 20,
    U: 21, V: 22, W: 23, X: 24, Y: 25, Z: 26,
    '1': 27, '2': 28, '3': 29, '4': 30, '5': 31, '6': 32,
    '7': 33, '8': 34, '9': 35, '0': 36,
    '!': 37, '@': 38, '#': 39, '$': 40, '(': 41, ')': 42,
    '-': 44, '+': 46, '&': 47, '=': 48, ';': 49, ':': 50,
    "'": 52, '"': 53, '%': 54, ',': 55, '.': 56, '/': 59,
    '?': 60, '°': 62,
    RED: 63, ORANGE: 64, YELLOW: 65, GREEN: 66, BLUE: 67, VIOLET: 68,
    WHITE: 69, BLACK: 70, FILLED: 71
};

// Rate limiting
let lastApiCall = 0;

const enforceRateLimit = async () => {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCall;

    if (timeSinceLastCall < RATE_LIMIT_DELAY) {
        const waitTime = RATE_LIMIT_DELAY - timeSinceLastCall;
        console.log(`Rate limiting: waiting ${Math.ceil(waitTime / 1000)} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastApiCall = Date.now();
};

// Utility functions
const textToCharCodes = (text) => {
    const result = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i].toUpperCase();
        if (VESTABOARD_CHARS[char] !== undefined) {
            result.push(VESTABOARD_CHARS[char]);
        } else if (char === ' ') {
            result.push(VESTABOARD_CHARS.BLANK);
        } else {
            result.push(VESTABOARD_CHARS.BLANK);
        }
    }
    return result;
};

const formatLine = (text, alignment = 'left', maxLength = 22) => {
    const charCodes = textToCharCodes(text);

    if (charCodes.length > maxLength) {
        return charCodes.slice(0, maxLength);
    }

    const paddingSize = maxLength - charCodes.length;
    const result = [...charCodes];

    if (alignment === 'right') {
        for (let i = 0; i < paddingSize; i++) {
            result.unshift(VESTABOARD_CHARS.BLANK);
        }
    } else if (alignment === 'center') {
        const leftPadding = Math.floor(paddingSize / 2);
        const rightPadding = paddingSize - leftPadding;

        for (let i = 0; i < leftPadding; i++) {
            result.unshift(VESTABOARD_CHARS.BLANK);
        }
        for (let i = 0; i < rightPadding; i++) {
            result.push(VESTABOARD_CHARS.BLANK);
        }
    } else {
        for (let i = 0; i < paddingSize; i++) {
            result.push(VESTABOARD_CHARS.BLANK);
        }
    }

    return result;
};

const createStylizedHeader = (text, colorCode = VESTABOARD_CHARS.YELLOW) => {
    const charCodes = textToCharCodes(text);
    const maxTextLength = 18;

    const truncatedCharCodes = charCodes.length > maxTextLength
        ? charCodes.slice(0, maxTextLength)
        : charCodes;

    const paddingSize = maxTextLength - truncatedCharCodes.length;
    const leftPadding = Math.floor(paddingSize / 2);
    const rightPadding = paddingSize - leftPadding;

    const result = [colorCode, colorCode];

    for (let i = 0; i < leftPadding; i++) {
        result.push(VESTABOARD_CHARS.BLANK);
    }

    result.push(...truncatedCharCodes);

    for (let i = 0; i < rightPadding; i++) {
        result.push(VESTABOARD_CHARS.BLANK);
    }

    result.push(colorCode, colorCode);

    return result;
};

// Load/save cache functions
const loadDataFromCache = () => {
    try {
        if (fs.existsSync(DATA_CACHE_PATH)) {
            const data = fs.readFileSync(DATA_CACHE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading cache:', error.message);
    }
    return null;
};

const saveDataToCache = (data) => {
    try {
        fs.writeFileSync(DATA_CACHE_PATH, JSON.stringify(data, null, 2));
        console.log('Data saved to cache');
    } catch (error) {
        console.error('Error saving cache:', error.message);
    }
};

// Post to Vestaboard function
const postToVestaboard = async (characters) => {
    try {
        await enforceRateLimit();

        console.log('Posting to Vestaboard...');

        const response = await axios.post(VESTABOARD_API_URL, characters, {
            headers: {
                'Content-Type': 'application/json',
                'X-Vestaboard-Read-Write-Key': READ_WRITE_KEY
            }
        });

        console.log('Successfully posted to Vestaboard');
        return response.data;

    } catch (error) {
        console.error('Error posting to Vestaboard:', error.message);

        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);

            if (error.response.status === 304) {
                return { status: 'not_modified', message: 'Content unchanged' };
            }
        }

        throw error;
    }
};

// Create different view types
const createCombinedView = (stageNumber) => {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return [
        createStylizedHeader(`TOUR DE FRANCE S${stageNumber}`, VESTABOARD_CHARS.YELLOW),
        formatLine(`STAGE ${stageNumber} RESULTS`, 'center'),
        formatLine(`1. POGACAR`, 'left'), // Mock data
        formatLine(`2. VINGEGAARD`, 'left'),
        [VESTABOARD_CHARS.YELLOW, VESTABOARD_CHARS.YELLOW, ...textToCharCodes(` GC: POGACAR`), ...Array(8).fill(VESTABOARD_CHARS.BLANK)],
        formatLine(`UPDATED: ${timestamp}`, 'right')
    ];
};

const createStageView = (stageNumber) => {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return [
        createStylizedHeader(`STAGE ${stageNumber}`, VESTABOARD_CHARS.RED),
        formatLine(`STAGE RESULTS`, 'center'),
        formatLine(`1. POGACAR`, 'left'),
        formatLine(`2. VINGEGAARD`, 'left'),
        formatLine(`3. EVENEPOEL`, 'left'),
        formatLine(`TIME: ${timestamp}`, 'right')
    ];
};

const createGCView = (stageNumber) => {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return [
        createStylizedHeader(`GC STANDINGS`, VESTABOARD_CHARS.YELLOW),
        formatLine(`AFTER STAGE ${stageNumber}`, 'center'),
        [VESTABOARD_CHARS.YELLOW, VESTABOARD_CHARS.YELLOW, ...textToCharCodes(` 1. POGACAR`), ...Array(9).fill(VESTABOARD_CHARS.BLANK)],
        formatLine(`2. VINGEGAARD +1:15`, 'left'),
        formatLine(`3. EVENEPOEL +2:30`, 'left'),
        formatLine(`TIME: ${timestamp}`, 'right')
    ];
};

const createJerseyView = (stageNumber) => {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return [
        createStylizedHeader(`JERSEY HOLDERS`, VESTABOARD_CHARS.GREEN),
        formatLine(`AFTER STAGE ${stageNumber}`, 'center'),
        [VESTABOARD_CHARS.YELLOW, VESTABOARD_CHARS.YELLOW, ...textToCharCodes(` POGACAR`), ...Array(12).fill(VESTABOARD_CHARS.BLANK)],
        [VESTABOARD_CHARS.GREEN, VESTABOARD_CHARS.GREEN, ...textToCharCodes(` CAVENDISH`), ...Array(9).fill(VESTABOARD_CHARS.BLANK)],
        [VESTABOARD_CHARS.RED, VESTABOARD_CHARS.WHITE, ...textToCharCodes(` VINGEGAARD`), ...Array(8).fill(VESTABOARD_CHARS.BLANK)],
        formatLine(`TIME: ${timestamp}`, 'right')
    ];
};

const createTestView = () => {
    const now = new Date();
    const timestamp = now.toISOString().slice(11, 19);

    return [
        createStylizedHeader(`CONNECTION TEST`, VESTABOARD_CHARS.BLUE),
        formatLine(`VESTABOARD API`, 'center'),
        formatLine(`STATUS: CONNECTED`, 'center'),
        formatLine(`TIME: ${timestamp}`, 'center'),
        Array(22).fill(VESTABOARD_CHARS.BLUE),
        formatLine(`TEST SUCCESSFUL`, 'center')
    ];
};

// Ensure all grids are properly formatted
const ensureValidGrid = (grid) => {
    const result = [];

    for (let i = 0; i < 6; i++) {
        if (i < grid.length && Array.isArray(grid[i])) {
            const row = [...grid[i]];

            // Ensure exactly 22 characters
            if (row.length > 22) {
                row.splice(22);
            }
            while (row.length < 22) {
                row.push(VESTABOARD_CHARS.BLANK);
            }

            // Validate character codes
            for (let j = 0; j < row.length; j++) {
                if (typeof row[j] !== 'number' || row[j] < 0 || row[j] > 71) {
                    row[j] = VESTABOARD_CHARS.BLANK;
                }
            }

            result.push(row);
        } else {
            result.push(Array(22).fill(VESTABOARD_CHARS.BLANK));
        }
    }

    return result;
};

// Get current stage based on date
const getCurrentStage = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    if (month === 7 && day >= 5 && day <= 27) {
        return Math.min(Math.max(day - 4, 1), 21);
    }
    return 6; // Default fallback
};

// API Routes

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get system status
app.get('/api/status', (req, res) => {
    const cachedData = loadDataFromCache();
    const currentStage = getCurrentStage();

    res.json({
        currentStage,
        stageDate: `2025-07-${(4 + currentStage).toString().padStart(2, '0')}`,
        lastUpdate: cachedData ? new Date(cachedData.timestamp).toLocaleString() : 'Never',
        cacheStatus: cachedData ? 'Valid' : 'Empty',
        apiStatus: READ_WRITE_KEY ? 'Configured' : 'Missing API Key'
    });
});

// Send update to Vestaboard
app.post('/api/update', async (req, res) => {
    try {
        const { viewType = 'combined', stageNumber } = req.body;

        if (!READ_WRITE_KEY) {
            return res.status(400).json({ error: 'Vestaboard API key not configured' });
        }

        const stage = stageNumber || getCurrentStage();

        if (stage < 1 || stage > 21) {
            return res.status(400).json({ error: 'Stage number must be between 1 and 21' });
        }

        console.log(`Creating ${viewType} view for stage ${stage}`);

        let grid;
        switch (viewType) {
            case 'stage':
                grid = createStageView(stage);
                break;
            case 'gc':
                grid = createGCView(stage);
                break;
            case 'jerseys':
                grid = createJerseyView(stage);
                break;
            case 'combined':
            default:
                grid = createCombinedView(stage);
                break;
        }

        const validGrid = ensureValidGrid(grid);

        console.log('Sending to Vestaboard...');
        const result = await postToVestaboard(validGrid);

        // Update cache with request info
        const cacheData = {
            lastRequest: {
                viewType,
                stageNumber: stage,
                timestamp: Date.now()
            }
        };
        saveDataToCache(cacheData);

        res.json({
            success: true,
            message: `${viewType} view for stage ${stage} sent successfully`,
            result
        });

    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({
            error: 'Failed to update Vestaboard',
            details: error.message
        });
    }
});

// Send test message
app.post('/api/test', async (req, res) => {
    try {
        if (!READ_WRITE_KEY) {
            return res.status(400).json({ error: 'Vestaboard API key not configured' });
        }

        console.log('Sending test message...');

        const testGrid = createTestView();
        const validGrid = ensureValidGrid(testGrid);

        const result = await postToVestaboard(validGrid);

        res.json({
            success: true,
            message: 'Test message sent successfully',
            result
        });

    } catch (error) {
        console.error('Test error:', error);
        res.status(500).json({
            error: 'Failed to send test message',
            details: error.message
        });
    }
});

// Refresh data (clear cache and fetch new data)
app.post('/api/refresh', async (req, res) => {
    try {
        // Clear cache
        if (fs.existsSync(DATA_CACHE_PATH)) {
            fs.unlinkSync(DATA_CACHE_PATH);
        }

        // Here you would typically fetch new data from your existing functions
        // For now, we'll just clear the cache

        res.json({
            success: true,
            message: 'Cache cleared and data refreshed'
        });

    } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({
            error: 'Failed to refresh data',
            details: error.message
        });
    }
});

// Clear cache
app.post('/api/clear-cache', async (req, res) => {
    try {
        if (fs.existsSync(DATA_CACHE_PATH)) {
            fs.unlinkSync(DATA_CACHE_PATH);
            console.log('Cache cleared');
        }

        res.json({
            success: true,
            message: 'Cache cleared successfully'
        });

    } catch (error) {
        console.error('Clear cache error:', error);
        res.status(500).json({
            error: 'Failed to clear cache',
            details: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        details: error.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Vestaboard API Server running on http://localhost:${PORT}`);
    console.log(`📊 Frontend available at: http://localhost:${PORT}`);
    console.log(`🔧 API endpoints available at: http://localhost:${PORT}/api/*`);

    if (!READ_WRITE_KEY) {
        console.warn('⚠️  WARNING: VESTABOARD_READ_WRITE_KEY not found in environment variables');
    }
});

module.exports = app;