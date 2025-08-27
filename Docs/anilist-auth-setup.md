# AniList API Setup Guide for Zoro Plugin

To log in, you'll need to create your own **Client ID** and **Client Secret** from AniList. Follow these steps—it’s quick and easy.

---

Watch a short tutorial here:  
[![Watch the YouTube Short](https://img.youtube.com/vi/1ZJzQomOBQA/0.jpg)](https://youtube.com/shorts/1ZJzQomOBQA)

## Step 1: Create an AniList App

1. Go to the AniList Developer Page: [https://anilist.co/settings/developer](https://anilist.co/settings/developer)  
2. Click **Create New Client** at the top.  
3. Fill in only these fields:  
   - **App Name**: `Zoro`  
   - **Redirect URI**: `https://anilist.co/api/v2/oauth/pin` 
  
4. Click **Save**.  
5. Copy your **Client ID** and **Client Secret**.

>Make sure the Redirect URI is exactly as shown; authentication will fail otherwise.

---

## Step 2: Authenticate Zoro with AniList

1. Open **Zoro plugin settings** in Obsidian.  
2. Click **Enter Client ID**, paste your **Client ID**, and confirm.  
3. Click **Enter Client Secret**, paste your **Client Secret**, and confirm.  
4. Click **Authenticate**.  
5. You’ll be redirected to AniList—log in (if needed) and **authorize** the app.  
6. Copy the **PIN code** displayed by AniList.  
7. Return to Obsidian and paste the PIN into the prompt.  
8. Wait a moment—you’ll see a  **Authenticated** notification when successful.

---
