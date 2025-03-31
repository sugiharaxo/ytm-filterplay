// Injector script (v48 - Replacement Strategy)
//console.log('YTM FilterPlay inject script loaded.');

// --- State Variables ---
let isFilteringActive = false;
// Keep clickedVideoIdForFilter - might be useful later for refining 'selected' state logic
// if the order in filteredSongsQueue doesn't perfectly match YT's internal assumptions.
let clickedVideoIdForFilter = null;
// let allowedVideoIdsForPlayback = []; // No longer needed for pruning
let filteredSongsQueue = []; // Store the full data for the filtered queue
let nextFilteredSongIndex = 0; // Track the next song index to send
let clearFilteringStateTimer = null;

// --- Event Listener ---
window.addEventListener('YTMFilterPlaybackRequest', (event) => {
    // console.log('YTM FilterPlay: YTMFilterPlaybackRequest event DETECTED.');
    if (event.detail && event.detail.targetVideoId && Array.isArray(event.detail.filteredSongsData)) {
        if (event.detail.filteredSongsData.length > 0) {
            clickedVideoIdForFilter = event.detail.targetVideoId;
            filteredSongsQueue = event.detail.filteredSongsData;
            nextFilteredSongIndex = 0;
            isFilteringActive = true;
            //console.log('YTM FilterPlay: Playback filter SET...');
            if (clearFilteringStateTimer) { clearTimeout(clearFilteringStateTimer); }
            clearFilteringStateTimer = setTimeout(() => {
                // console.log('YTM FilterPlay: Clearing filter state after timeout.');
                resetFilterState('timeout');
            }, 30000);
        } else {
            // console.log('YTM FilterPlay: Filter event received but no filtered songs...');
            resetFilterState('no filtered songs');
        }
    } else {
        // Keep warn: console.warn('YTM FilterPlay: Invalid event detail...');
        resetFilterState('invalid event data');
    }
});

// --- Helper Functions ---
function resetFilterState(reason) {
    //console.log(`YTM FilterPlay: Resetting filter state...`);
    isFilteringActive = false;
    clickedVideoIdForFilter = null;
    // allowedVideoIdsForPlayback = [];
    filteredSongsQueue = [];
    nextFilteredSongIndex = 0;
    if (clearFilteringStateTimer) {
        clearTimeout(clearFilteringStateTimer);
        clearFilteringStateTimer = null;
    }
}

// Removed cache functions

// --- Fetch Override ---
const originalFetch = window.fetch;
window.fetch = async function(input, options) {
    const requestUrl = typeof input === 'string' ? input : input.url;
    if (!requestUrl.includes('youtubei/v1/')) {
        return originalFetch(input, options);
    }

    if (requestUrl.includes('/next') && isFilteringActive) {
        // console.log('YTM FilterPlay: Intercepted /next request while filter IS ACTIVE.');
        try {
            const response = await originalFetch(input, options);
            const responseClone = response.clone();
            const data = await responseClone.json();

            const isWatchPageStructure = !!data?.contents?.singleColumnMusicWatchNextResultsRenderer;
            // console.log(`YTM FilterPlay: Is target structure...? ${isWatchPageStructure}`);

            let originalPlaylistContents = null;
            let basePath = null;

            const path1 = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
            if (path1?.contents) {
                // console.log('YTM FilterPlay (inject v48): Found playlist contents via Path 1...');
                originalPlaylistContents = path1.contents;
                basePath = path1;
            } else {
                const path2 = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;
                if (path2?.contents) {
                    // console.log('YTM FilterPlay (inject v48): Found playlist contents via Path 2...');
                    originalPlaylistContents = path2.contents;
                    basePath = path2;
                } else {
                    // console.log('YTM FilterPlay (inject v48): Could not find playlist contents...');
                }
            }

            // --- Start REPLACEMENT logic ---
            if (isFilteringActive && isWatchPageStructure && basePath && filteredSongsQueue.length > 0) {
                // console.log(`YTM FilterPlay: Applying REPLACEMENT...`);
                const itemsToGenerate = originalPlaylistContents?.length ?? 20;
                const newContents = [];
                const isFirstBatch = (nextFilteredSongIndex === 0);

                // console.log(`YTM FilterPlay: Will attempt to generate up to ${itemsToGenerate} items...`);
                for (let i = 0; i < itemsToGenerate; i++) {
                    const currentQueueIndex = nextFilteredSongIndex + i;
                    if (currentQueueIndex >= filteredSongsQueue.length) {
                        // console.log(`YTM FilterPlay: Reached end of filtered queue...`);
                        break;
                    }
                    try {
                        const songData = filteredSongsQueue[currentQueueIndex];
                        if (!songData?.playlistPanelVideoRenderer) {
                            // Keep warn: console.warn(`YTM FilterPlay: Song data lacks expected structure...`);
                            continue;
                        }
                        const songDataCopy = JSON.parse(JSON.stringify(songData));
                        if (songDataCopy.playlistPanelVideoRenderer) {
                           songDataCopy.playlistPanelVideoRenderer.selected = (i === 0 && isFirstBatch);
                           newContents.push(songDataCopy);
                        }
                    } catch (cloneError) {
                         // Keep error: console.error(`YTM FilterPlay: Error cloning song data...`);
                         continue; 
                    }
                }
                
                const generatedCount = newContents.length;
                // console.log(`YTM FilterPlay: Generated ${generatedCount} items...`);

                nextFilteredSongIndex += generatedCount;
                basePath.contents = newContents;

                if (nextFilteredSongIndex >= filteredSongsQueue.length) {
                    // console.log('YTM FilterPlay: Filtered queue finished. Removing continuations.');
                    if (basePath.continuations) {
                        basePath.continuations = [];
                    }
                    resetFilterState('queue finished'); // Log is inside reset function
                } else {
                    // console.log(`YTM FilterPlay: More songs remaining...`);
                }

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            } else {
                 // console.log('YTM FilterPlay: Skipping replacement...');
            }
            // --- End REPLACEMENT logic ---
            // console.log('YTM FilterPlay: Passing through original /next response...');
            return response; 
        } catch (error) {
            // Keep error: console.error('YTM FilterPlay: Error processing /next request...');
            resetFilterState('error in fetch override');
            return originalFetch(input, options);
        }
    }

    return originalFetch(input, options);
};

//console.log('YTM FilterPlay inject script initialized.');