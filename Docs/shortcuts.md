Shortcuts add custom website searches to the **Details Panel → External Links**.  
This lets you search an item’s title on any site with one click.  

---

# Setup  
1. Search for anything on your chosen site (review, wiki, streaming, etc.).  
2. Copy the **search URL** from your browser.  
   - Example: `https://www.netflix.com/search?q=Squid%20Game`  
3. Paste it into the **Shortcuts** section in settings (per media type).  
4. The link will now appear in the **External Links** section of the Details Panel.  

---

## If the URL doesn’t work  
Some sites use a search format the plugin can’t auto-detect. In that case:  

1. **Turn off “Auto-format URL”** in settings.  
2. On the target site, search exactly for: **`zoro zoro`**   
3. Copy the resulting search URL. 
   - Example: `https://m.youtube.com/results?sp=mAEA&search_query=zoro+zoro`  
4. Paste it into the plugin’s **Shortcuts** settings.  

The plugin uses this special search to learn the site’s URL structure:  
- Everything before **zoro zoro** is treated as the search template.  
- The character or symbol used between the two words (e.g., `+`, `%20`, `-`) is saved as the space replacement.