To log in, you’ll need to create your own **Client ID** and **Client Secret** from MyAnimeList. Follow these steps—it’s quick and easy.

---

Watch a short tutorial here:  
[![Watch the YouTube Short](https://img.youtube.com/vi/SIOmZo6MSh4/0.jpg)](https://youtube.com/shorts/SIOmZo6MSh4)

---

## Step 1: Create a MAL App

1. Go to the MAL API Page: [https://myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)  
2. Click **Create App**.  
3. Fill in these fields:  
   - **App Name**: `Zoro`  
   - **App Type**: `Web`  
   - **Redirect URI**: `http://localhost:8080/callback`  
   - **Description**: `Obsidian plugin for managing anime, manga, tv show and movie lists`  
   - **Company Name**: `Zoro`  
4. Click **Save**.  
5. Copy your **Client ID** and **Client Secret**.  

> Make sure the Redirect URI is exactly `http://localhost:8080/callback`; authentication will fail otherwise.

---

## Step 2: Authenticate Zoro with MAL

1. Open **Zoro plugin settings** in Obsidian.  
2. Click **Enter Client ID**, paste your **Client ID**, and confirm.  
3. Click **Enter Client Secret**, paste your **Client Secret**, and confirm.  
4. Click **Authenticate**.  
5. You’ll be redirected to MAL—log in (if needed) and **authorize** the app.  
6. MAL will display a URL like:  
   `http://localhost:8080/callback?code=ABC123`  
   → Copy the **entire URL**.  
7. Return to Obsidian and paste the URL into the prompt.  
8. Wait a moment—you’ll see an **Authenticated** notification when successful.  

---

That’s it! Your MAL account is now securely connected to **Zoro**.