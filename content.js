// Listen for messages from the background script
chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type === 'QUEUE_MODIFIED') {
            console.log('Queue was modified:', request.data);
        }
    }
);

// Content script (v50)
console.log('YTM FilterPlay content script loaded'); // Keep basic load log

// --- State Variables ---
let currentFilterQuery = '';
let filterDebounceTimer = null;
let filterObserver = null;
let uiObserver = null;
let filterInput = null;
let filterButton = null;
let filterContainer = null;
let actionsContainer = null;
let filterExpanded = false;
let filterTimeout = null;



// --- Debounce Function ---
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    };
}

// --- Filter Functionality ---

// Function to get searchable text from a list item (Adapt selectors if needed)
function getItemSearchableText(itemElement) {
    // Selectors for title and artist/album byline
    const titleSelectors = [
        '#title', // Common title element
        '.title.ytmusic-responsive-list-item-renderer', // Title in list items
        '.title.ytmusic-grid-renderer' // Title in grid items
    ];
    const bylineSelectors = [
        '.secondary-flex-columns yt-formatted-string', // Standard byline
        '#byline', // Another possible byline container
        '.byline-wrapper .byline' // Common structure
    ];

    let text = '';

    // Find title
    for (const selector of titleSelectors) {
        const titleElement = itemElement.querySelector(selector);
        if (titleElement) {
            text += (titleElement.textContent || '').trim() + ' ';
            break; // Found one, move on
        }
    }

    // Find byline text (artists, album)
    for (const selector of bylineSelectors) {
        const bylineElements = itemElement.querySelectorAll(selector);
        if (bylineElements.length > 0) {
            bylineElements.forEach(el => {
                text += (el.textContent || '').trim() + ' ';
            });
            break; // Found some, move on
        }
    }

    return text.toLowerCase().replace(/\s+/g, ' '); // Normalize whitespace
}

// Function to apply the filter to visible items (v46 - Populate ID list)
function applyFilter(query) {
    const cleanedQuery = query.trim().toLowerCase();
    // console.log(`Applying filter raw query: "${cleanedQuery}"`);

    const terms = cleanedQuery.split(',') 
                              .map(term => term.trim()) 
                              .filter(term => term.length > 0);

    // console.log(`Applying filter terms:`, terms);

    const listContainer = document.querySelector('ytmusic-playlist-shelf-renderer #contents'); 
    if (!listContainer) {
        console.warn("YTM FilterPlay: Could not find list container to apply filter."); // Keep warning
        return;
    }
    
    const items = listContainer.querySelectorAll('ytmusic-responsive-list-item-renderer');
    let visibleCount = 0;
    items.forEach(item => {
        const itemText = getItemSearchableText(item);
        const shouldShow = !terms.length || terms.some(term => itemText.includes(term));
        
        if (shouldShow) {
            item.style.display = '';
            visibleCount++;
            const videoId = getVideoIdFromListItem(item);
            if (videoId) {
                // currentVisibleVideoIds.push(videoId); // REMOVED - Unused
            }
        } else {
            item.style.display = 'none';
        }
    });
    // console.log(`Filter applied, ${visibleCount} items visible. Visible IDs:`, currentVisibleVideoIds.length);
}

// Function to get video ID from a list item
function getVideoIdFromListItem(itemElement) {
    // console.log("YTM FilterPlay (content v33) Attempting to get videoId for:", itemElement);
    
    const titleLink = itemElement.querySelector('.title-column a.yt-simple-endpoint');
    if (titleLink?.href?.includes('watch?v=')) {
        try {
            const url = new URL(titleLink.href);
            const videoId = url.searchParams.get('v');
            if (videoId) {
                 // console.log("  - Found videoId via Title Link Href:", videoId);
                 return videoId;
            }
        } catch (e) {
            console.warn("  - Error parsing title link href:", e); // Keep warning
        }
    }

    const playButtonRenderer = itemElement.querySelector('ytmusic-play-button-renderer');
    if (playButtonRenderer?.__data?.navigationEndpoint?.watchEndpoint?.videoId) {
        // console.log("  - Found videoId via Play Button Renderer __data");
        return playButtonRenderer.__data.navigationEndpoint.watchEndpoint.videoId;
    }

    if (itemElement?.__data?.videoId) {
        // console.log("  - Found videoId via itemElement __data");
        return itemElement.__data.videoId;
    }
    
    const endpointElement = itemElement.querySelector('[navigationendpoint]');
    if (endpointElement?.__data?.navigationEndpoint?.watchEndpoint?.videoId) {
         // console.log("  - Found videoId via [navigationendpoint] __data");
        return endpointElement.__data.navigationEndpoint.watchEndpoint.videoId;
    }
    
    if (itemElement.tagName === 'YTMUSIC-PLAYLIST-PANEL-VIDEO-RENDERER' && itemElement.__data?.videoId) {
         // console.log("  - Found videoId via Playlist Panel Renderer tagName + __data");
         return itemElement.__data.videoId;
    }
    
    console.warn("  - Could not find videoId using known methods."); // Keep warning
    return null;
}

// NEW: Function to get searchable text from a song DATA OBJECT (v2 - handles multiple byline runs)
function getItemSearchableTextFromData(itemData) {
    let text = '';
    // Use optional chaining extensively as structure might vary slightly
    // Handle both potential top-level structures (playlistPanelVideoRenderer or musicResponsiveListItemRenderer)
    const renderer = itemData?.playlistPanelVideoRenderer || itemData?.musicResponsiveListItemRenderer || itemData; 
    
    // Title: Try standard title path or flex column path
    if (renderer?.title?.runs?.[0]?.text) {
        text += renderer.title.runs[0].text + ' ';
    } else if (renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text) {
        // Path for musicResponsiveListItemRenderer title
        text += renderer.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].text + ' ';
    }

    // Byline (Artist, Album, etc.): Try standard longByline or flex column path
    let bylineRunsSource = null;
    if (renderer?.longBylineText?.runs) {
        bylineRunsSource = renderer.longBylineText.runs;
    } else if (renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) {
         // Path for musicResponsiveListItemRenderer byline
        bylineRunsSource = renderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text.runs;
    }

    if (bylineRunsSource) {
        // Concatenate text from ALL runs in the byline
        bylineRunsSource.forEach(run => { 
            // Also check navigationEndpoint browseId for potential artist/album IDs if needed later
            if (run?.text) { // Only add runs that contain text
                text += run.text + ' ';
            }
        });
    }
    
    return text.toLowerCase().replace(/\s+/g, ' ').trim(); // Normalize whitespace and trim
}

// Function to get the full playlist data array (v15 - DOM Only)
function getFullPlaylistData() {
    console.log("YTM FilterPlay: Getting playlist data via DOM query..."); // Updated log

    // --- Removed __data__ checks --- 

    // --- DOM Query Logic (Previously Fallback) ---
    const playlistContentsContainer = document.querySelector('ytmusic-playlist-shelf-renderer #contents'); 

    if (!playlistContentsContainer) {
        console.warn("YTM FilterPlay: Could not find playlist container 'ytmusic-playlist-shelf-renderer #contents'.");
        // No other fallback, return empty
        console.error("YTM FilterPlay: Failed to get playlist data.");
        return []; 
    } 
    
    // Query for items *only within that specific container*
    const items = playlistContentsContainer.querySelectorAll(':scope > ytmusic-responsive-list-item-renderer');
    
    if (items.length === 0) {
         console.warn("YTM FilterPlay: Found playlist container, but no 'ytmusic-responsive-list-item-renderer' items within it.");
         console.error("YTM FilterPlay: Failed to get playlist data.");
         return [];
    }

    // console.log(`YTM FilterPlay: Found ${items.length} items via scoped DOM query.`);
    const dataFromDom = [];
    items.forEach((item, index) => {
        // ** Prioritize item.__data__ if it exists! ** (Keep this check as item-level __data__ can sometimes exist even if container-level doesn't)
        if (item.__data__) {
            // console.log(`  [DOM Item ${index}] Using item.__data__`);
            if (item.__data__.musicResponsiveListItemRenderer || item.__data__.playlistPanelVideoRenderer) {
                // *** IMPORTANT: Need to potentially transform musicResponsiveListItemRenderer to playlistPanelVideoRenderer here if inject.js expects only the latter ***
                // For now, pushing whatever structure is found. If inject.js fails, need transformation.
                // Let's add a temporary transformation attempt here based on previous findings
                let dataToPush = item.__data__;
                if (dataToPush.musicResponsiveListItemRenderer && !dataToPush.playlistPanelVideoRenderer) {
                    console.warn(`   [DOM Item ${index}] item.__data__ is musicResponsiveListItemRenderer, attempting transformation.`);
                    dataToPush = transformMusicResponsiveToPlaylistPanel(dataToPush.musicResponsiveListItemRenderer);
                } else if (dataToPush.playlistPanelVideoRenderer) {
                     // console.log(`   [DOM Item ${index}] item.__data__ is already playlistPanelVideoRenderer.`);
                }
                
                if (dataToPush.playlistPanelVideoRenderer) { // Push only if it has the target structure (original or transformed)
                    dataFromDom.push(dataToPush); 
                } else {
                    console.warn(`   [DOM Item ${index}] item.__data__ structure unknown or transformation failed, skipping.`);
                }
            } else {
                // console.warn(`  [DOM Item ${index}] item.__data__ found, but lacks expected renderer structure, attempting reconstruction from DOM as fallback.`);
                // Proceed to minimal reconstruction using DOM elements below as a last resort
                const reconstructedData = reconstructFromDomElements(item, index); // Use helper
                if (reconstructedData) {
                   dataFromDom.push(reconstructedData);
                }
            }
        } else {
            // console.warn(`  [DOM Item ${index}] item.__data__ not found, reconstructing minimally from DOM.`);
            const reconstructedData = reconstructFromDomElements(item, index); // Use helper
            if (reconstructedData) {
               dataFromDom.push(reconstructedData);
            }
        }
    });

    if (dataFromDom.length === 0) {
        console.error("YTM FilterPlay: Processed DOM items but failed to extract/reconstruct any valid data.");
    }
    
    // console.warn(`YTM FilterPlay Constructed data from scoped DOM query. Completeness depends on reconstruction.`);
    return dataFromDom;
}

// *** NEW HELPER: For DOM Reconstruction ***
function reconstructFromDomElements(item, index) {
    const videoId = getVideoIdFromListItem(item);
    const titleText = item.querySelector('.title')?.textContent || '';
    
    // Byline Runs (v10 logic)
    const bylineContainer = item.querySelector('.secondary-flex-columns');
    let bylineRuns = [];
    const uniqueRunTexts = new Set();
    if (bylineContainer) {
        const columnElements = bylineContainer.querySelectorAll('yt-formatted-string.flex-column');
        if (columnElements.length > 0) {
            columnElements.forEach((columnEl, colIndex) => {
                const runText = columnEl.textContent?.trim();
                if (runText && runText !== '•' && !uniqueRunTexts.has(runText)) {
                    bylineRuns.push({ text: runText });
                    uniqueRunTexts.add(runText);
                }
            });
        } else {
            const fullBylineText = bylineContainer.textContent?.trim();
            if (fullBylineText) {
                const parts = fullBylineText.split('•').map(p => p.trim()).filter(p => p && !uniqueRunTexts.has(p));
                if (parts.length > 0) {
                    bylineRuns = parts.map(part => ({ text: part }));
                    parts.forEach(part => uniqueRunTexts.add(part));
                } else if (fullBylineText && fullBylineText !== '•' && !uniqueRunTexts.has(fullBylineText)) {
                    bylineRuns.push({ text: fullBylineText });
                    uniqueRunTexts.add(fullBylineText);
                }
            }
        }
    }
    if (bylineRuns.length === 0 && bylineContainer?.textContent?.trim() && bylineContainer.textContent.trim() !== '•') {
         console.error(`  [DOM Item ${index}] Reconstruction: Byline parsing STILL empty.`);
    }

    // Thumbnail
    let thumbnailUrl = null;
    const imgElement = item.querySelector('ytmusic-thumbnail-renderer img#img');
    if (imgElement?.src) {
        thumbnailUrl = imgElement.src;
        thumbnailUrl = thumbnailUrl.replace(/=w\d+-h\d+/, '=w544-h544'); 
    }

    // LengthText
    let lengthTextString = "0:00";
    const durationElement = item.querySelector('.fixed-columns yt-formatted-string');
    if (durationElement?.title) { lengthTextString = durationElement.title.trim(); }

    if (videoId) {
        // Thumbnail Object
        let finalThumbnailObject = { thumbnails: [] }; 
        if (thumbnailUrl) {
            const baseThumbnailUrl = thumbnailUrl.replace(/=w\d+-h\d+.*$/, ''); 
            const standardSizes = [60, 120, 180, 226, 302, 544]; 
            const generatedThumbnails = standardSizes.map(size => ({
                url: `${baseThumbnailUrl}=w${size}-h${size}-l90-rj`, 
                width: size,
                height: size
            }));
            finalThumbnailObject.thumbnails = generatedThumbnails;
        } 
        
        // Byline Formatting
        let finalLongBylineRuns = [];
        if (bylineRuns && bylineRuns.length > 0) {
            bylineRuns.forEach((run, runIndex) => {
                finalLongBylineRuns.push(run); 
                if (runIndex < bylineRuns.length - 1) {
                    finalLongBylineRuns.push({ text: " • " }); 
                }
            });
        } 
        let finalShortBylineRuns = [];
        if (bylineRuns && bylineRuns.length > 0) { finalShortBylineRuns.push(bylineRuns[0]); }

        // Construct playlistPanelVideoRenderer (v14 structure)
        return { 
            playlistPanelVideoRenderer: { 
                videoId: videoId, 
                title: { runs: [{ text: titleText }] },
                longBylineText: { runs: finalLongBylineRuns }, 
                shortBylineText: { runs: finalShortBylineRuns }, 
                thumbnail: finalThumbnailObject, 
                lengthText: { runs: [{ text: lengthTextString }], accessibility: { accessibilityData: { label: `${lengthTextString} duration` } } }, 
                selected: false, 
                navigationEndpoint: { clickTrackingParams: "", watchEndpoint: { videoId: videoId } },
                _isReconstructed: true
            }
        };
    } else {
        console.warn(`  [DOM Item ${index}] Reconstruction: Could not get videoId.`);
        return null;
    }
}

// *** NEW HELPER: Transform musicResponsiveListItemRenderer to playlistPanelVideoRenderer ***
function transformMusicResponsiveToPlaylistPanel(renderer) {
    if (!renderer || !renderer.videoId) {
        console.warn("Transformation failed: Invalid input renderer.");
        return {}; // Return empty object or null
    }
    
    const videoId = renderer.videoId;
    const titleText = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
    const bylineRunsRaw = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const thumbnailData = renderer.thumbnail?.musicThumbnailRenderer || {thumbnails: []};
    const lengthTextString = renderer.fixedColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '0:00'; // Check fixed columns

    // Format bylines (similar to DOM reconstruction)
    let finalLongBylineRuns = [];
    const uniqueRawRuns = bylineRunsRaw.filter((run, index, self) => run.text && run.text !== '•' && index === self.findIndex(r => r.text === run.text));
    uniqueRawRuns.forEach((run, runIndex) => {
        finalLongBylineRuns.push(run); 
        if (runIndex < uniqueRawRuns.length - 1) {
            finalLongBylineRuns.push({ text: " • " }); 
        }
    });
    let finalShortBylineRuns = uniqueRawRuns.length > 0 ? [uniqueRawRuns[0]] : [];

    return { 
        playlistPanelVideoRenderer: { 
            videoId: videoId, 
            title: { runs: [{ text: titleText }] },
            longBylineText: { runs: finalLongBylineRuns }, 
            shortBylineText: { runs: finalShortBylineRuns }, 
            thumbnail: thumbnailData, // Assume structure is compatible
            lengthText: { runs: [{ text: lengthTextString }], accessibility: { accessibilityData: { label: `${lengthTextString} duration` } } }, 
            selected: false, 
            // Reconstruct minimal nav endpoint (might be missing playlistId etc.)
            navigationEndpoint: renderer.navigationEndpoint || { clickTrackingParams: "", watchEndpoint: { videoId: videoId } },
            // Add other fields if directly available and needed (menu, trackingParams?)
            menu: renderer.menu, // Pass through if exists
            trackingParams: renderer.trackingParams, // Pass through if exists
            _isDataSource: '__data__(transformed)' // Flag for debugging
        }
    };
}

// NEW: Function to filter the full data based on query
function filterFullPlaylistData(fullData, query) {
    const cleanedQuery = query.trim().toLowerCase();
    if (!cleanedQuery) {
        // If no query, return deep copies of everything
        return JSON.parse(JSON.stringify(fullData)); 
    }
    
    const terms = cleanedQuery.split(',')
                              .map(term => term.trim())
                              .filter(term => term.length > 0);

    // console.log(`Filtering full data with terms:`, terms);

    const filteredData = [];
    // console.log(`YTM FilterPlay: Processing ${fullData?.length ?? 0} items from getFullPlaylistData...`);
    fullData.forEach((itemData, index) => { // Add index for clarity
        const itemText = getItemSearchableTextFromData(itemData);
        // console.log(`  [Item ${index}] Extracted Text: "${itemText}"`, itemData);
        
        const shouldInclude = terms.some(term => itemText.includes(term));
        
        if (shouldInclude) {
            try {
                 // IMPORTANT: Deep clone the item to avoid modifying the original source data
                 // and to ensure inject.js gets independent objects.
                filteredData.push(JSON.parse(JSON.stringify(itemData)));
            } catch (e) {
                console.error("YTM FilterPlay: Error cloning item data during filtering:", e, itemData);
            }
        }
    });
    // console.log(`Filtered full data down to ${filteredData.length} items.`);
    return filteredData;
}

// --- Helper Functions ---

// --- UI Injection ---
function injectFilterUI(targetContainer) { 
    console.log("YTM FilterPlay: Injecting UI into provided target container.", targetContainer);
    
    if (targetContainer.querySelector('#ytm-filterplay-container')) {
        console.log("YTM FilterPlay: UI container already exists in provided element. Skipping injection.");
        return; 
    }

    // --- Create Elements ---
    const filterContainer = document.createElement('div');
    filterContainer.id = 'ytm-filterplay-container';
    filterContainer.style.display = 'inline-flex'; // Use inline-flex for button and input alignment
    filterContainer.style.alignItems = 'center';
    filterContainer.style.position = 'relative'; // Keep relative for absolute input positioning
    filterContainer.style.marginLeft = '8px';

    const filterButton = document.createElement('button');
    filterButton.id = 'ytm-filterplay-button';
    filterButton.classList.add('ytmusic-button-renderer');

    filterButton.innerHTML = `
        <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" style="pointer-events: none; display: block; width: 24px; height: 24px; fill: currentColor;"><g><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"></path></g></svg>
    `;

    const searchInput = document.createElement('input');
    searchInput.id = 'ytm-filterplay-input';
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter...';

    // Append button first, then input
    filterContainer.appendChild(filterButton);
    filterContainer.appendChild(searchInput);

    // Find the sort button and insert after it
    const sortMenu = targetContainer.querySelector('yt-sort-filter-sub-menu-renderer');
    if (sortMenu) {
        sortMenu.parentNode.insertBefore(filterContainer, sortMenu.nextSibling);
        console.log("YTM FilterPlay: Found sort menu, inserted filter button after it.");
    } else {
        targetContainer.appendChild(filterContainer);
        console.log("YTM FilterPlay: Sort menu not found, appended filter button to container.");
    }

    // --- CSS for Styling and Animation ---
    const styleId = 'ytm-filterplay-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #ytm-filterplay-button {
                background: none; 
                border: none; 
                color: var(--ytmusic-text-primary, inherit); 
                font-family: inherit; 
                font-size: inherit; 
                padding: 8px; 
                margin: 0; 
                cursor: pointer; 
                display: inline-flex; 
                align-items: center; 
                border-radius: 4px; 
                transition: background-color 0.3s ease;
                position: relative; /* Add relative positioning */
                top: -1px; /* Alignment of filter button */
            }
            #ytm-filterplay-button:hover {
                 /* Style unchanged */
                background-color: var(--ytmusic-menu-item-hover-background-color, rgba(255, 255, 255, 0.1));
            }
            #ytm-filterplay-input {
                 /* Style unchanged */
                position: absolute; 
                left: 0; 
                top: 50%;
                transform: translateY(-50%); 
                width: 150px;
                opacity: 0;
                pointer-events: none; 
                border: none;
                border-bottom: 1px solid var(--ytmusic-text-secondary, grey);
                background-color: transparent;
                color: var(--ytmusic-text-primary, inherit);
                font-family: inherit;
                font-size: 14px;
                padding: 4px 6px;
                transition: opacity 0.3s ease, left 0s ease 0.3s; 
                outline: none;
                z-index: -1; 
            }
            #ytm-filterplay-container.active #ytm-filterplay-input {
                 /* Style unchanged */
                opacity: 1;
                left: calc(100% + 8px); 
                pointer-events: auto; 
                transition: opacity 0.3s ease; 
                 z-index: 1; 
            }
        `;
        document.head.appendChild(style);
    }

    // --- Add Event Listeners (unchanged) ---
    filterButton.addEventListener('click', (event) => {
        event.stopPropagation();
        // Get references dynamically inside the handler
        const container = event.currentTarget.closest('#ytm-filterplay-container');
        const input = container?.querySelector('#ytm-filterplay-input');
        
        container?.classList.toggle('active');
        
        if (container?.classList.contains('active') && input) {
            input.focus();
        } else {
            input?.blur(); // Remove focus when hiding
        }
    });

    // Get references dynamically where needed
    document.addEventListener('input', (event) => {
        if (event.target.id === 'ytm-filterplay-input') {
            const query = event.target.value.toLowerCase();
            currentFilterQuery = query;
            applyFilter(query);
        }
    });
    
    let justClickedButton = false;
    // Need to query for button dynamically if it might not exist yet
    document.addEventListener('mousedown', (event) => {
         if (event.target.closest('#ytm-filterplay-button')) {
              justClickedButton = true;
         }
    });

    document.addEventListener('click', (event) => {
        const activeContainer = document.querySelector('#ytm-filterplay-container.active');
        if (!activeContainer) return; // Do nothing if not active
        
        if (justClickedButton) {
            justClickedButton = false;
            return;
        }
        
        // If click is outside the active container
        if (!activeContainer.contains(event.target)) {
            const input = activeContainer.querySelector('#ytm-filterplay-input');
            // --> Add check: Only close if input is empty <--
            if (input && input.value.trim() === '') {
                activeContainer.classList.remove('active');
                input?.blur();
            } // Otherwise, if input has text, do nothing and keep it open
        }
    }, true); // Use capture phase

    console.log("YTM FilterPlay: UI Injected Successfully into target container.");
}

// Function to attempt finding the injection target container (v28)
function findInjectionTargetContainer() {
    const selectors = [
        // Target the side-aligned-item-renderer within specific parents
        '.fullbleed.ytmusic-section-list-renderer > ytmusic-playlist-shelf-renderer ytmusic-side-aligned-item-renderer',
        'ytmusic-playlist-shelf-renderer ytmusic-side-aligned-item-renderer', 
        'ytmusic-playlist-header-renderer ytmusic-side-aligned-item-renderer'
    ];
    for (const selector of selectors) {
        const container = document.querySelector(selector);
        if (container) {
            // console.log(`YTM FilterPlay: Found injection target container with selector: ${selector}`);
            return container;
        }
    }
    // console.log("YTM FilterPlay: Injection target container not found with any known selector.");
    return null; 
}

// Function to observe the document for playlist content and UI changes (v29 - Reduced Logging)
function observeForUI() {
    if (uiObserver) uiObserver.disconnect();

    uiObserver = new MutationObserver((mutationsList, observer) => {
        const targetContainer = findInjectionTargetContainer(); 
        if (targetContainer && !targetContainer.querySelector('#ytm-filterplay-container')) {
             //console.log(`YTM FilterPlay: Found injection target container via observer..., injecting UI.`);
             injectFilterUI(targetContainer); 
        } 
    });
    //console.log("YTM FilterPlay: UI Observer started...");
    const initialContainer = findInjectionTargetContainer(); 
    if (initialContainer && !initialContainer.querySelector('#ytm-filterplay-container')) {
        //console.log(`YTM FilterPlay: Found injection target container on initial check..., injecting UI.`);
        injectFilterUI(initialContainer);
    } else if (!initialContainer) {
         // console.log("YTM FilterPlay: Target container not found on initial check.");
    }
}

// --- Scroll Handler ---
const handleScroll = debounce(() => {
    if (!window.location.pathname === '/playlist') return;
    
    // Check if we're near the bottom of the page
    const scrollPosition = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // If we're within 300px of the bottom, reapply filter if active
    if (documentHeight - scrollPosition < 300 && currentFilterQuery) {
        console.log("YTM FilterPlay: Near bottom of page, re-applying filter.");
        applyFilter(currentFilterQuery);
    }
}, 500);

// --- Initialization and Main Logic ---

function initializeFiltering() {
    console.log("YTM FilterPlay: Initializing filtering..."); // Keep basic init log

    if (window.location.pathname === '/playlist') {
        console.log("YTM FilterPlay: On a playlist page, observing for UI.");
        observeForUI();

        // *** NEW: Restore filter state if query exists ***
        if (currentFilterQuery) {
            // console.log(`YTM FilterPlay: Restoring previous filter query: "${currentFilterQuery}"`);
            setTimeout(() => {
                const container = document.querySelector('#ytm-filterplay-container');
                const input = document.querySelector('#ytm-filterplay-input');
                if (container && input) {
                    // console.log("YTM FilterPlay: Found filter UI, applying restored state.");
                    container.classList.add('active');
                    input.value = currentFilterQuery;
                    // Re-apply the DOM filter immediately
                    applyFilter(currentFilterQuery);
                } else {
                    console.warn("YTM FilterPlay: Could not find filter UI elements immediately after navigation to restore state.");
                    // The UI observer should eventually inject it, but the input won't be pre-filled
                    // unless the user interacts again. Could enhance this later if needed.
                }
            }, 250); // Wait 250ms for UI to potentially render
        }

    } else {
        console.log(`YTM FilterPlay: Not on a playlist page (pathname: ${window.location.pathname}), UI injection skipped.`);
        if (uiObserver) uiObserver.disconnect(); 
    }

    // Setup observer for the entire app container
    const appContainer = document.querySelector('ytmusic-app');
    if (appContainer && !filterObserver) {
        filterObserver = new MutationObserver((mutations) => {
            // Check if new songs were added
            const songAddedMutation = mutations.some(mutation => {
                return Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeName === 'YTMUSIC-RESPONSIVE-LIST-ITEM-RENDERER') {
                        return true;
                    }
                    
                    // Also check for container elements that might contain songs
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const hasSongs = node.querySelector('ytmusic-responsive-list-item-renderer');
                        return !!hasSongs;
                    }
                    
                    return false;
                });
            });
            
            if (songAddedMutation && currentFilterQuery) {
                console.log("YTM FilterPlay: New songs detected, re-applying filter.");
                applyFilter(currentFilterQuery);
            }
        });
        
        filterObserver.observe(appContainer, { 
            childList: true, 
            subtree: true 
        });
        console.log("YTM FilterPlay: App container observer started.");
        
        // Add scroll event listener
        window.addEventListener('scroll', handleScroll);
    } else if (!appContainer && filterObserver) {
        console.log("YTM FilterPlay: App container not found, disconnecting observer.");
        filterObserver.disconnect();
        filterObserver = null;
        window.removeEventListener('scroll', handleScroll);
    } else if (appContainer && filterObserver) {
        // Already observing, do nothing
    } else {
        // App container not found, couldn't start observer
        console.warn("YTM FilterPlay: Could not find app container to start observer.");
    }
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    //console.log("YTM FilterPlay: DOM fully loaded and parsed.");
    initializeFiltering(); // Initialize filtering logic

    // Delegated click listener for play buttons (v50 - Dispatch on Window)
    document.body.addEventListener('click', (event) => {
        const playButton = event.target.closest('ytmusic-play-button-renderer');
        
        if (playButton && playButton.closest('ytmusic-playlist-shelf-renderer #contents, ytmusic-section-list-renderer #contents')) { 
            const listItem = playButton.closest('ytmusic-responsive-list-item-renderer');
            if (!listItem) return;
            
            // Check if the filter UI is active AND the item would be hidden by the DOM filter
            // (We still let YTM handle the click, but we send the filtered list to inject.js)
            const isHiddenByDomFilter = listItem.style.display === 'none'; 
            if (currentFilterQuery && isHiddenByDomFilter) {
                 // console.log("YTM FilterPlay: Play clicked on an item hidden by DOM filter...");
            } else if (!currentFilterQuery) {
                 // console.log("YTM FilterPlay: Play button clicked, no filter active...");
                 return; 
            } else {
                 // console.log("YTM FilterPlay: Play button clicked on a visible item...");
            }

            const targetVideoId = getVideoIdFromListItem(listItem);
            
            if (targetVideoId) {
                // console.log(`YTM FilterPlay: Extracted targetVideoId: ${targetVideoId}`);
                
                // 1. Get the full playlist data
                const allPlaylistItemsData = getFullPlaylistData();
                // console.log("YTM FilterPlay: Data returned by getFullPlaylistData:", allPlaylistItemsData);

                if (!allPlaylistItemsData || allPlaylistItemsData.length === 0) { return; }

                // 2. Filter the full data based on the current filter query
                const filteredSongsData = filterFullPlaylistData(allPlaylistItemsData, currentFilterQuery);
                 if (filteredSongsData.length === 0) { return; }

                // 3. Prepare the context for inject.js
                const filterContext = {
                    targetVideoId: targetVideoId, // The ID the user actually clicked
                    filteredSongsData: filteredSongsData // The array of *full data objects* for matched songs
                    // 'action' field removed as inject.js doesn't seem to use it
                };

                //console.log(`YTM FilterPlay: Dispatching YTMFilterPlaybackRequest...`);
                console.log(`YTM FilterPlay: Dispatching YTMFilterPlaybackRequest. Target: ${targetVideoId}. Filtered songs count: ${filteredSongsData.length}.`);
                
                // Dispatch the custom event ON WINDOW with the new data structure
                window.dispatchEvent(new CustomEvent('YTMFilterPlaybackRequest', { 
                    detail: filterContext 
                }));

            } else { }
        }
    }, true); // Use capture phase

    window.addEventListener('yt-navigate-finish', initializeFiltering); 
    
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            //console.log("YTM FilterPlay: URL change detected, re-initializing.");
            initializeFiltering();
        }
    }).observe(document.body, {subtree: true, childList: true}); 

}); // End DOMContentLoaded

// --- Inject Script (v49) ---
function injectScript(filePath) {
    // console.log(`YTM FilterPlay (content v49): Attempting to inject script: ${filePath}`);
    try {
        const script = document.createElement('script');
        const url = chrome.runtime.getURL(filePath);
        // console.log(`YTM FilterPlay (content v49): Got script URL: ${url}`);
        script.src = url;
        script.onload = function() {
            // console.log(`YTM FilterPlay (content v49): Script ${filePath} loaded successfully.`);
        };
        script.onerror = function(e) { };
        (document.head || document.documentElement).appendChild(script);
        // console.log(`YTM FilterPlay (content v49): Appended script tag for ${filePath} to document.`);
    } catch (e) { }
}

// Inject the script on load (This call is correct)
window.addEventListener('load', () => {
    injectScript('inject.js');
}, { once: true });

//console.log('YTM FilterPlay content script initialized');