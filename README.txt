STATFORGE - Pixel Academy: Battle of Minds
==========================================

HOW TO OPEN
-----------
Double-click index.html (works offline in Chrome/Edge/Firefox/Safari), or host the folder.
GitHub Pages: create a repository, upload the CONTENTS of this folder so that index.html is at the repository
root, then Settings > Pages > Deploy from branch (main, / root). Paths are relative and lowercase, so they
are safe on GitHub Pages (which is case-sensitive). Do not use C:\... paths anywhere.

WHAT IS ALREADY HERE (working game)
-----------------------------------
index.html            Game page (entry point, must stay at the root).
css/style.css         All styles, including the large responsive text and mobile layout.
js/core/main.js       The whole game: rendering, characters, Levels 1-6, shop, audio, touch controls.
assets/characters/sam|ash|tia|clar/   front.png (select-screen art) and sheet.jpg (voxel model sheet).
assets/level1/pieces/ The seven Level 1 piece images (data, data_org, types, levels, central, variability, interpretation).
assets/audio/bgm/statforge_bgm.wav    The BGM. To add more tracks: put the file here and add it to AUDIO.tracks / AUDIO.map in main.js.

WHERE TO PUT NEW FILES (empty folders are kept with .gitkeep)
-------------------------------------------------------------
Characters            assets/characters/<name>/      (models, textures, artwork)
Ma'am Olga            assets/npcs/maam-olga/         (official voxel design/reference). Her in-game model is still the built-in
                                                      block model in main.js (function drawChar / OLGA); the official design image
                                                      has not been integrated yet.
Animations            assets/animations/characters|npcs/
Level 1 pieces        assets/level1/pieces/          (file names are referenced by TY in main.js); UI art in level1/ui
Level 2-6 art         assets/level2 ... assets/level6/<subfolder>/
Academy / shared      assets/environments/academy|shared/
Cosmetics             assets/cosmetics/<category>/   (items are defined in the COS table in main.js)
BGM / SFX             assets/audio/bgm/ and assets/audio/sfx/  (current SFX are generated in code, sfx() function)
Fonts/textures/icons  assets/fonts, assets/textures, assets/icons
UI art                assets/ui/buttons|hud|menus|backgrounds/
JavaScript            js/core (now), js/player, js/levels/levelN, js/systems, js/mobile, js/ui (for splitting main.js later)
CSS                   css/
Data (JSON)           data/characters|cosmetics|levels|questions|progression/
Documentation         docs/

NOTES
-----
* The game script is currently one file because the systems share state; the other js/ folders are ready for a later split.
* Progress is saved in the browser (localStorage key statforge_v1).

VIDEO LESSONS
-------------
Put your lesson videos here (MP4/H.264 plays everywhere, including iPhone):
  assets/videos/lesson2/lesson2.mp4   (unlocks after Level 1 is defeated)
  assets/videos/lesson3/lesson3.mp4   (after Level 2)
  assets/videos/lesson4/lesson4.mp4   (after Level 3)
  assets/videos/lesson5/lesson5.mp4   (after Level 4)
  assets/videos/lesson6/lesson6.mp4   (after Level 5)
If your files have other names, edit VIDEO_FILES near the top of the VIDEO LESSONS block in js/core/main.js.
The Learning Room is the blue screen stall on the west side of Pixel Academy (press E / tap TALK).
