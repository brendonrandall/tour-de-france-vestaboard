// Tour de France Vestaboard Integration with Advanced Formatting
const axios = require('axios');
const cheerio = require('cheerio');
const dotenv = require('dotenv');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

// Character codes for Vestaboard
const VESTABOARD_CHARS = {
    // Blank
    BLANK: 0,

    // Letters (uppercase only on Vestaboard)
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10,
    K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, T: 20,
    U: 21, V: 22, W: 23, X: 24, Y: 25, Z: 26,

    // Numbers
    '1': 27, '2': 28, '3': 29, '4': 30, '5': 31, '6': 32,
    '7': 33, '8': 34, '9': 35, '0': 36,

    // Special characters
    '!': 37, '@': 38, '#': 39, '$': 40, '(': 41, ')': 42,
    '-': 44, '+': 46, '&': 47, '=': 48, ';': 49, ':': 50,
    "'": 52, '"': 53, '%': 54, ',': 55, '.': 56, '/': 59,
    '?': 60, '°': 62,

    // Colors
    RED: 63, ORANGE: 64, YELLOW: 65, GREEN: 66, BLUE: 67, VIOLET: 68,
    WHITE: 69, BLACK: 70, FILLED: 71
};

// Text alignment options
const ALIGN = {
    LEFT: 'left',
    CENTER: 'center',
    RIGHT: 'right'
};

// Constants
const READ_WRITE_KEY = process.env.VESTABOARD_READ_WRITE_KEY;
const VESTABOARD_API_URL = 'https://rw.vestaboard.com/';
const DATA_CACHE_PATH = path.join(__dirname, 'cache.json');
const CACHE_DURATION = parseInt(process.env.CACHE_DURATION || '3600000', 10); // Default: 1 hour

const RATE_LIMIT_DELAY = 16000; // 16 seconds to be safe (API requires 15 seconds)
let lastApiCall = 0; // Track last API call timestamp

// Rate limiting helper function
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


// Current date to determine the Tour de France stage
const getCurrentDate = () => {
    const now = new Date();
    return {
        year: now.getFullYear(),
        month: now.getMonth() + 1, // JavaScript months are 0-indexed
        day: now.getDate()
    };
};

// Convert text to character codes
const textToCharCodes = (text) => {
    const result = [];

    for (let i = 0; i < text.length; i++) {
        const char = text[i].toUpperCase();

        if (VESTABOARD_CHARS[char] !== undefined) {
            result.push(VESTABOARD_CHARS[char]);
        } else if (char === ' ') {
            result.push(VESTABOARD_CHARS.BLANK);
        } else {
            // Character not supported, replace with blank
            result.push(VESTABOARD_CHARS.BLANK);
        }
    }

    return result;
};

// Format a single line of text with alignment
const formatLine = (text, alignment = ALIGN.LEFT, maxLength = 22) => {
    const charCodes = textToCharCodes(text);

    // Truncate if longer than maxLength
    if (charCodes.length > maxLength) {
        return charCodes.slice(0, maxLength);
    }

    // Add padding based on alignment
    const paddingSize = maxLength - charCodes.length;
    const result = [...charCodes];

    if (alignment === ALIGN.RIGHT) {
        // Right alignment: add padding at the beginning
        for (let i = 0; i < paddingSize; i++) {
            result.unshift(VESTABOARD_CHARS.BLANK);
        }
    } else if (alignment === ALIGN.CENTER) {
        // Center alignment: add padding evenly on both sides
        const leftPadding = Math.floor(paddingSize / 2);
        const rightPadding = paddingSize - leftPadding;

        // Add left padding
        for (let i = 0; i < leftPadding; i++) {
            result.unshift(VESTABOARD_CHARS.BLANK);
        }

        // Add right padding
        for (let i = 0; i < rightPadding; i++) {
            result.push(VESTABOARD_CHARS.BLANK);
        }
    } else {
        // Left alignment: add padding at the end
        for (let i = 0; i < paddingSize; i++) {
            result.push(VESTABOARD_CHARS.BLANK);
        }
    }

    return result;
};

// Create a stylized header with color accents
const createStylizedHeader = (text, colorCode = VESTABOARD_CHARS.YELLOW) => {
    const charCodes = textToCharCodes(text);
    const maxTextLength = 18; // 22 - 4 for color blocks (2 on each side)

    // Truncate if necessary
    const truncatedCharCodes = charCodes.length > maxTextLength
        ? charCodes.slice(0, maxTextLength)
        : charCodes;

    // Calculate padding for center alignment
    const paddingSize = maxTextLength - truncatedCharCodes.length;
    const leftPadding = Math.floor(paddingSize / 2);
    const rightPadding = paddingSize - leftPadding;

    // Create the final line with color blocks
    const result = [
        colorCode,
        colorCode
    ];

    // Add left padding
    for (let i = 0; i < leftPadding; i++) {
        result.push(VESTABOARD_CHARS.BLANK);
    }

    // Add text
    result.push(...truncatedCharCodes);

    // Add right padding
    for (let i = 0; i < rightPadding; i++) {
        result.push(VESTABOARD_CHARS.BLANK);
    }

    // Add ending color blocks
    result.push(colorCode);
    result.push(colorCode);

    return result;
};

// Get the current Tour de France stage based on date
const getCurrentStage = async () => {
    // Check for override in environment variables
    if (process.env.CURRENT_STAGE) {
        const stage = parseInt(process.env.CURRENT_STAGE, 10);
        console.log(`Using stage number from environment: ${stage}`);
        return stage;
    }

    const { year } = getCurrentDate();
    const url = `https://www.procyclingstats.com/race/tour-de-france/${year}`;

    try {
        console.log(`Fetching Tour de France schedule from ${url}...`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // Find all rows with stage information
        // This table appears to have days of the week in one column and dates in another
        const stages = [];

        // Look for stage data in the page - table structure changed
        $('table tbody tr').each((i, row) => {
            const cells = $(row).find('td');

            // Check if this row contains a stage reference
            const stageText = $(row).text().trim();

            // Look for "Stage X" pattern in any cell
            const stageMatch = stageText.match(/Stage\s+(\d+)/i);
            if (stageMatch) {
                const stageNumber = parseInt(stageMatch[1], 10);

                // Look for date information
                const dateText = $(cells).first().text().trim();
                const dateMatch = dateText.match(/(\d+)\/(\d+)/);

                if (dateMatch) {
                    // Date is in DD/MM format for European date format
                    const day = parseInt(dateMatch[1], 10);
                    const month = parseInt(dateMatch[2], 10);

                    // In Europe, dates are day/month, so 05/07 means July 5th, not May 7th
                    const stageDate = new Date(year, month - 1, day); // Month is 0-indexed in JS

                    stages.push({
                        date: stageDate,
                        stageNumber
                    });

                    console.log(`Found Stage ${stageNumber} on ${day}/${month}/${year} (${stageDate.toISOString().split('T')[0]})`);
                } else if (dateText.startsWith('Stage')) {
                    // Alternative approach: If no date, use stage number from previous rows
                    // This happens in result tables where stages are listed with winners
                    console.log(`Found Stage ${stageNumber} (no date)`);
                    stages.push({
                        stageNumber,
                        completed: true // Mark as completed since it has results
                    });
                }
            }
        });

        // If we still have no stages, try alternative parsing
        if (stages.length === 0) {
            // Look for completed stages with results
            $('table.basic tbody tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const col1 = $(cells[0]).text().trim();
                    const col2 = $(cells[1]).text().trim();

                    // Check if first column contains stage info
                    const stageMatch = col1.match(/Stage\s+(\d+)/i);
                    if (stageMatch) {
                        const stageNumber = parseInt(stageMatch[1], 10);

                        // If second column has a rider name, the stage is completed
                        if (col2 && col2.includes(' ')) {
                            console.log(`Found completed Stage ${stageNumber} with winner ${col2}`);
                            stages.push({
                                stageNumber,
                                completed: true
                            });
                        } else {
                            console.log(`Found upcoming Stage ${stageNumber}`);
                            stages.push({
                                stageNumber,
                                completed: false
                            });
                        }
                    }
                }
            });
        }

        console.log(`Found ${stages.length} stages`);

        // If we found stages with dates, use those to determine current stage
        const stagesWithDates = stages.filter(stage => stage.date);
        if (stagesWithDates.length > 0) {
            // Sort stages by date
            stagesWithDates.sort((a, b) => a.date - b.date);

            // Find the current or most recent stage
            const today = new Date();
            console.log(`Today: ${today.toISOString().split('T')[0]}`);
            today.setHours(0, 0, 0, 0);

            // Find current stage (today's stage)
            const currentStage = stagesWithDates.find(stage => {
                const stageDate = new Date(stage.date);
                stageDate.setHours(0, 0, 0, 0);
                return stageDate.getTime() === today.getTime();
            });

            if (currentStage) {
                console.log(`Found current stage: ${currentStage.stageNumber}`);
                return currentStage.stageNumber;
            }

            // If no stage today, find the most recent stage
            console.log(`No stage today, looking for most recent stage...`);
            for (let i = stagesWithDates.length - 1; i >= 0; i--) {
                const stageDate = new Date(stagesWithDates[i].date);
                stageDate.setHours(0, 0, 0, 0);
                if (stageDate < today) {
                    console.log(`Found most recent stage: ${stagesWithDates[i].stageNumber}`);
                    return stagesWithDates[i].stageNumber;
                }
            }

            // If Tour hasn't started yet, return the first stage
            console.log(`Tour hasn't started yet, returning first stage: ${stagesWithDates[0].stageNumber}`);
            return stagesWithDates[0].stageNumber;
        }

        // If we only have stage numbers without dates (from results table)
        if (stages.length > 0) {
            // Find the highest completed stage
            const completedStages = stages.filter(stage => stage.completed);
            if (completedStages.length > 0) {
                // Get the highest stage number
                const highestStage = Math.max(...completedStages.map(stage => stage.stageNumber));
                console.log(`Using highest completed stage: ${highestStage}`);
                return highestStage;
            }

            // If no completed stages, use the first stage
            console.log(`No completed stages, using first stage: ${stages[0].stageNumber}`);
            return stages[0].stageNumber;
        }

        // Fallback: Check if we're in July (Tour de France month) and set a stage based on day
        const currentMonth = new Date().getMonth() + 1; // 1-indexed month
        const currentDay = new Date().getDate();

        if (currentMonth === 7 && currentDay >= 5 && currentDay <= 27) {
            // Approximate stage based on date (Tour typically starts first Saturday in July)
            const approximateStage = Math.min(currentDay - 4, 21); // Max 21 stages
            console.log(`Approximating stage based on July date: ${approximateStage}`);
            return approximateStage;
        }

        // Last resort: try to get current stage from the URL or page content
        const pageUrl = response.request.res.responseUrl || url;
        const urlMatch = pageUrl.match(/stage-(\d+)/i);
        if (urlMatch) {
            console.log(`Extracted stage from URL: ${urlMatch[1]}`);
            return parseInt(urlMatch[1], 10);
        }

        // If all else fails, use stage 6 (current stage from the date)
        console.log(`Using hardcoded current stage: 6`);
        return 6;

    } catch (error) {
        console.error('Error fetching Tour de France schedule:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
        }

        // Fallback to current stage based on today's date in July
        const currentMonth = new Date().getMonth() + 1; // 1-indexed month
        const currentDay = new Date().getDate();

        if (currentMonth === 7 && currentDay >= 5 && currentDay <= 27) {
            // Approximate stage based on date (Tour typically starts first Saturday in July)
            const approximateStage = Math.min(currentDay - 4, 21); // Max 21 stages
            console.log(`Approximating stage based on July date: ${approximateStage}`);
            return approximateStage;
        }

        // Final fallback to stage 6
        console.log(`Using fallback stage number due to error: 6`);
        return 6;
    }
};

// Fetch stage results
const fetchStageResults = async (stageNumber, year) => {
    const url = `https://www.procyclingstats.com/race/tour-de-france/${year}/stage-${stageNumber}`;

    try {
        console.log(`Fetching stage results from ${url}...`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const results = [];

        // Extract the top 5 riders
        $('table.results tbody tr').slice(0, 5).each((i, element) => {
            const position = $(element).find('td').eq(0).text().trim();
            const riderName = $(element).find('td.name a').text().trim();
            const teamName = $(element).find('td a.team').text().trim();

            if (position && riderName) {
                results.push({
                    position,
                    rider: riderName,
                    team: teamName
                });
            }
        });

        return results;
    } catch (error) {
        console.error(`Error fetching stage ${stageNumber} results:`, error.message);
        return [];
    }
};

// Fetch GC standings
const fetchGCResults = async (stageNumber, year) => {
    const url = `https://www.procyclingstats.com/race/tour-de-france/${year}/stage-${stageNumber}-gc`;

    try {
        console.log(`Fetching GC results from ${url}...`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const results = [];

        // Extract the top 5 riders in GC
        $('table.results tbody tr').slice(0, 5).each((i, element) => {
            const position = $(element).find('td').eq(0).text().trim();
            const riderName = $(element).find('td.name a').text().trim();
            const teamName = $(element).find('td a.team').text().trim();
            const timeGap = $(element).find('td.time').text().trim();

            if (position && riderName) {
                results.push({
                    position,
                    rider: riderName,
                    team: teamName,
                    timeGap: position === '1' ? 'LEADER' : timeGap
                });
            }
        });

        return results;
    } catch (error) {
        console.error(`Error fetching GC results after stage ${stageNumber}:`, error.message);
        return [];
    }
};

// Fetch jersey holders (yellow, green, polka dot, white)
const fetchJerseyHolders = async (stageNumber, year) => {
    const url = `https://www.procyclingstats.com/race/tour-de-france/${year}/stage-${stageNumber}`;

    try {
        console.log(`Fetching jersey holders from ${url}...`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const jerseys = {
            yellow: null,  // GC leader
            green: null,   // Points classification
            polkaDot: null, // Mountains classification
            white: null    // Young rider classification
        };

        // Try to find jersey holders in the page
        // This is more complex and might need adjustments based on the actual HTML structure

        // Look for jersey information in the results section
        $('div.res-right div.restabs ul li').each((i, element) => {
            const text = $(element).text().trim().toLowerCase();

            if (text.includes('points') || text.includes('green')) {
                const holderSelector = $(element).find('a').attr('href');
                if (holderSelector) {
                    const holder = $(holderSelector).find('td.name a').first().text().trim();
                    if (holder) jerseys.green = holder;
                }
            } else if (text.includes('mountain') || text.includes('polka')) {
                const holderSelector = $(element).find('a').attr('href');
                if (holderSelector) {
                    const holder = $(holderSelector).find('td.name a').first().text().trim();
                    if (holder) jerseys.polkaDot = holder;
                }
            } else if (text.includes('young') || text.includes('white')) {
                const holderSelector = $(element).find('a').attr('href');
                if (holderSelector) {
                    const holder = $(holderSelector).find('td.name a').first().text().trim();
                    if (holder) jerseys.white = holder;
                }
            }
        });

        // Yellow jersey holder is the GC leader
        $('table.results tbody tr').first().each((i, element) => {
            const riderName = $(element).find('td.name a').text().trim();
            if (riderName) jerseys.yellow = riderName;
        });

        return jerseys;
    } catch (error) {
        console.error(`Error fetching jersey holders after stage ${stageNumber}:`, error.message);
        return {
            yellow: null,
            green: null,
            polkaDot: null,
            white: null
        };
    }
};

// Additional validation function
const validateEnvironment = () => {
    if (!READ_WRITE_KEY) {
        console.error('ERROR: VESTABOARD_READ_WRITE_KEY is required in .env file');
        process.exit(1);
    }

    // Log configuration
    console.log('Configuration:');
    console.log(`- Cache Duration: ${CACHE_DURATION}ms (${Math.floor(CACHE_DURATION / 60000)} minutes)`);
    console.log(`- Rate Limit Delay: ${RATE_LIMIT_DELAY}ms`);
    console.log(`- Test Mode: ${process.env.RUN_TEST ? 'ENABLED' : 'DISABLED'}`);
    console.log(`- Update Schedule: ${process.env.UPDATE_SCHEDULE || '0 * * * * (hourly)'}`);

    if (process.env.CURRENT_STAGE) {
        console.log(`- Stage Override: ${process.env.CURRENT_STAGE}`);
    }

    if (process.env.DISPLAY_MODE) {
        console.log(`- Display Mode: ${process.env.DISPLAY_MODE}`);
    }
};

const validateVestaboardMessage = (message) => {
    if (!message || !message.characters) {
        console.error('Message is missing characters array');
        return false;
    }

    const characters = message.characters;

    if (!Array.isArray(characters)) {
        console.error('Characters must be an array');
        return false;
    }

    if (characters.length !== 6) {
        console.error(`Characters array must have exactly 6 rows, found ${characters.length}`);
        return false;
    }

    for (let i = 0; i < characters.length; i++) {
        if (!Array.isArray(characters[i])) {
            console.error(`Row ${i} must be an array`);
            return false;
        }

        if (characters[i].length !== 22) {
            console.error(`Row ${i} must have exactly 22 characters, found ${characters[i].length}`);
            return false;
        }

        for (let j = 0; j < characters[i].length; j++) {
            const code = characters[i][j];
            if (typeof code !== 'number' || code < 0 || code > 71) {
                console.error(`Invalid character code at position [${i}][${j}]: ${code}`);
                return false;
            }
        }
    }

    return true;
};

// Also update the formatTourData function to return the array directly
const formatTourData = (stageResults, gcResults, jerseys, stageNumber) => {
    // Create a colorful header
    const headerRow = createStylizedHeader(`TOUR DE FRANCE S${stageNumber}`, VESTABOARD_CHARS.YELLOW);

    // Format rider names - get just the last name
    const formatRiderName = (name) => {
        if (!name) return '';
        const parts = name.split(' ');
        return parts[parts.length - 1].toUpperCase();
    };

    // Create stage results row
    let stageRow = [];
    if (stageResults.length > 0) {
        stageRow = formatLine(`1. ${formatRiderName(stageResults[0].rider)}`, ALIGN.LEFT);
    } else {
        stageRow = formatLine(`STAGE RESULTS PENDING`, ALIGN.LEFT);
    }

    // Create second rider in stage results
    let secondRiderRow = [];
    if (stageResults.length > 1) {
        secondRiderRow = formatLine(`2. ${formatRiderName(stageResults[1].rider)}`, ALIGN.LEFT);
    } else {
        secondRiderRow = formatLine(``, ALIGN.LEFT);
    }

    // Create GC leader row with yellow indicator
    let yellowRow = [];
    if (gcResults.length > 0) {
        // Use yellow color blocks to indicate yellow jersey
        yellowRow = [
            VESTABOARD_CHARS.YELLOW,
            VESTABOARD_CHARS.YELLOW,
            ...textToCharCodes(` GC: ${formatRiderName(gcResults[0].rider)}`),
        ];
        // Pad to full width
        while (yellowRow.length < 22) {
            yellowRow.push(VESTABOARD_CHARS.BLANK);
        }
    } else {
        yellowRow = formatLine(`GC RESULTS PENDING`, ALIGN.LEFT);
    }

    // Create jersey holders row (limited to what can fit)
    let jerseysRow = [];
    if (jerseys && (jerseys.green || jerseys.polkaDot)) {
        const jerseyTexts = [];
        if (jerseys.green) {
            jerseyTexts.push(`G:${formatRiderName(jerseys.green)}`);
        }
        if (jerseys.polkaDot) {
            jerseyTexts.push(`M:${formatRiderName(jerseys.polkaDot)}`);
        }
        jerseysRow = formatLine(jerseyTexts.join(' '), ALIGN.LEFT);
    } else {
        jerseysRow = formatLine(``, ALIGN.LEFT);
    }

    // Create timestamp that changes every minute to ensure uniqueness
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Create the final character grid (6 rows x 22 columns)
    const characterGrid = [
        headerRow,
        stageRow,
        secondRiderRow,
        yellowRow,
        jerseysRow,
        formatLine(`UPDATED: ${timestamp}`, ALIGN.RIGHT)
    ];

    // Ensure all rows are exactly 22 characters long
    for (let i = 0; i < characterGrid.length; i++) {
        if (characterGrid[i].length > 22) {
            characterGrid[i] = characterGrid[i].slice(0, 22);
        }
        while (characterGrid[i].length < 22) {
            characterGrid[i].push(VESTABOARD_CHARS.BLANK);
        }
    }

    // Ensure we have exactly 6 rows
    while (characterGrid.length < 6) {
        characterGrid.push(Array(22).fill(VESTABOARD_CHARS.BLANK));
    }
    if (characterGrid.length > 6) {
        characterGrid.splice(6); // Truncate to 6 rows
    }

    // Validate all character codes are valid numbers between 0-71
    for (let i = 0; i < characterGrid.length; i++) {
        for (let j = 0; j < characterGrid[i].length; j++) {
            const code = characterGrid[i][j];
            if (typeof code !== 'number' || code < 0 || code > 71) {
                console.warn(`Invalid character code at position [${i}][${j}]: ${code}, replacing with BLANK`);
                characterGrid[i][j] = VESTABOARD_CHARS.BLANK;
            }
        }
    }

    return {
        characters: characterGrid
    };
};

// Updated post to Vestaboard function with correct API format
const postToVestaboard = async (message, isTest = false) => {
    try {
        // Enforce rate limiting
        await enforceRateLimit();

        console.log(isTest ? 'Testing connection to Vestaboard...' : 'Posting message to Vestaboard...');

        // Check if message has characters array
        if (!message || !message.characters) {
            console.error('Message is missing characters array');
            return null;
        }

        const characters = message.characters;

        // Validate the character array format
        if (!Array.isArray(characters)) {
            console.error('Characters must be an array');
            return null;
        }

        if (characters.length !== 6) {
            console.error(`Characters array must have exactly 6 rows, found ${characters.length}`);
            return null;
        }

        for (let i = 0; i < characters.length; i++) {
            if (!Array.isArray(characters[i])) {
                console.error(`Row ${i} must be an array`);
                return null;
            }

            if (characters[i].length !== 22) {
                console.error(`Row ${i} must have exactly 22 characters, found ${characters[i].length}`);
                return null;
            }

            for (let j = 0; j < characters[i].length; j++) {
                const code = characters[i][j];
                if (typeof code !== 'number' || code < 0 || code > 71) {
                    console.error(`Invalid character code at position [${i}][${j}]: ${code}`);
                    return null;
                }
            }
        }

        if (isTest) {
            console.log('Sending test message with character array...');
        } else {
            console.log('Sending main message with character array...');
            console.log('Message preview (first row):', characters[0]);
        }

        // Send character array directly to API
        const response = await axios.post(VESTABOARD_API_URL, characters, {
            headers: {
                'Content-Type': 'application/json',
                'X-Vestaboard-Read-Write-Key': READ_WRITE_KEY
            }
        });

        console.log(`${isTest ? 'Test' : 'Main'} message posted to Vestaboard successfully!`);
        return response.data;

    } catch (error) {
        console.error(`Error posting ${isTest ? 'test' : 'main'} message to Vestaboard:`, error.message);

        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);

            // Handle 304 (Not Modified) as success for test messages
            if (error.response.status === 304) {
                console.log('Message not modified (304) - this means the API is working but content is the same');
                return { status: 'not_modified', message: 'Content unchanged' };
            }

            // Handle rate limiting
            if (error.response.status === 503) {
                console.error('Rate limited! The API calls are too close together.');
                return null;
            }

            // If there's a 400 error, try with simple text as a fallback (only for main messages)
            if (error.response.status === 400 && !isTest) {
                console.error('Character array that caused the error:', JSON.stringify(message.characters, null, 2));
                console.log('Trying with simplified text message as fallback...');

                try {
                    // Create very simple text message
                    const simpleText = 'TOUR DE FRANCE\nSTAGE RESULTS\n' + new Date().toLocaleTimeString();

                    // Enforce rate limiting for fallback
                    await enforceRateLimit();

                    const response = await axios.post(VESTABOARD_API_URL, { text: simpleText }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Vestaboard-Read-Write-Key': READ_WRITE_KEY
                        }
                    });
                    console.log('Simple text message posted successfully');
                    return response.data;
                } catch (fallbackError) {
                    console.error('Even simplified text message failed:', fallbackError.message);
                    return null;
                }
            }
        }
        return null;
    }
};

// Save data to cache
const saveDataToCache = (data) => {
    try {
        fs.writeFileSync(DATA_CACHE_PATH, JSON.stringify(data, null, 2));
        console.log('Data saved to cache');
    } catch (error) {
        console.error('Error saving data to cache:', error.message);
    }
};

// Load data from cache
const loadDataFromCache = () => {
    try {
        if (fs.existsSync(DATA_CACHE_PATH)) {
            const data = fs.readFileSync(DATA_CACHE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading data from cache:', error.message);
    }
    return null;
};

// Updated updateVestaboard function to handle the new format
const updateVestaboard = async () => {
    try {
        const { year } = getCurrentDate();

        // Get current stage
        const stageNumber = await getCurrentStage();
        if (!stageNumber) {
            console.error('Could not determine the current stage');
            return;
        }

        console.log(`Current stage: ${stageNumber}`);

        // Check cache first
        const cachedData = loadDataFromCache();
        if (cachedData &&
            cachedData.stageNumber === stageNumber &&
            cachedData.year === year &&
            cachedData.timestamp > Date.now() - CACHE_DURATION) {

            console.log('Using cached data');
            const formattedMessage = formatTourData(
                cachedData.stageResults,
                cachedData.gcResults,
                cachedData.jerseys,
                stageNumber
            );
            await postToVestaboard(formattedMessage, false);
            return;
        }

        // Fetch fresh data
        console.log('Fetching fresh Tour de France data...');
        const [stageResults, gcResults, jerseys] = await Promise.all([
            fetchStageResults(stageNumber, year),
            fetchGCResults(stageNumber, year),
            fetchJerseyHolders(stageNumber, year)
        ]);

        // Save to cache
        saveDataToCache({
            stageNumber,
            year,
            stageResults,
            gcResults,
            jerseys,
            timestamp: Date.now()
        });

        // Format and post to Vestaboard
        const formattedMessage = formatTourData(stageResults, gcResults, jerseys, stageNumber);
        await postToVestaboard(formattedMessage, false);

    } catch (error) {
        console.error('Error updating Vestaboard:', error.message);
    }
};


// Fixed test function with correct API format
const testVestaboardConnection = async () => {
    // Only run test if explicitly requested
    if (!process.env.RUN_TEST) {
        console.log('Skipping connection test (set RUN_TEST=true to enable)');
        return true; // Assume connection is good
    }

    try {
        console.log('=== VESTABOARD CONNECTION TEST ===');

        // Create unique test message with timestamp
        const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS format
        const testGrid = Array(6).fill().map(() => Array(22).fill(VESTABOARD_CHARS.BLANK));

        // Add "TEST" to first row
        const testText = `TEST ${timestamp}`;
        const testChars = textToCharCodes(testText);

        // Center the test text
        const startPos = Math.floor((22 - testChars.length) / 2);
        for (let i = 0; i < testChars.length && i < 22; i++) {
            testGrid[0][startPos + i] = testChars[i];
        }

        // Add a colored border to make it visually different
        for (let i = 0; i < 22; i++) {
            testGrid[1][i] = VESTABOARD_CHARS.BLUE; // Blue line
            testGrid[2][i] = VESTABOARD_CHARS.BLANK; // Blank line
        }

        // Test the character-based API
        const testMessage = { characters: testGrid };
        const result = await postToVestaboard(testMessage, true);

        if (result) {
            console.log('✓ Vestaboard connection test successful');
            return true;
        } else {
            console.log('✗ Vestaboard connection test failed');
            return false;
        }

    } catch (error) {
        console.error('Vestaboard connection test failed:', error.message);
        return false;
    }
};

// Main function
const main = async () => {
    validateEnvironment();

    console.log('=== TOUR DE FRANCE VESTABOARD INTEGRATION ===');
    console.log(`Started at: ${new Date().toISOString()}`);

    // Test connection only if explicitly requested
    const connectionTest = await testVestaboardConnection();
    if (!connectionTest && process.env.RUN_TEST) {
        console.error('Connection test failed. Continuing anyway...');
    }

    // Run immediately on startup
    console.log('Running initial update...');
    await updateVestaboard();

    // Schedule to run every hour (or custom schedule)
    const schedule = process.env.UPDATE_SCHEDULE || '0 * * * *';
    cron.schedule(schedule, async () => {
        console.log(`Running scheduled update at ${new Date().toISOString()}...`);
        await updateVestaboard();
    });

    console.log(`Scheduled to update on cron pattern: ${schedule}`);
    console.log('Integration is running. Press Ctrl+C to stop.');
};

// Start the application
main();