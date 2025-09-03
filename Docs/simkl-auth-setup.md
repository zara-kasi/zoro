To log in, you'll need to create your own **Client ID** and **Client Secret** from Simkl. Follow these steps—it’s quick and easy.

---

Watch a short tutorial here:  
[![Watch the YouTube Short](https://img.youtube.com/vi/GiAPkSijeo8/0.jpg)](https://m.youtube.com/shorts/GiAPkSijeo8)

---

## Step 1: Create a Simkl App

1. Go to the Simkl Developer Page: [https://simkl.com/settings/developer/new/](https://simkl.com/settings/developer/new/)  
2. Fill in these fields:  
   - **App Name**: `Zoro`  
   - **Description**: `Obsidian plugin for managing anime, manga, tv shows and movie lists`  
   - **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob`  
3. Click **Save**.  
4. Copy your **Client ID** and **Client Secret**.  

> Make sure the Redirect URI is exactly `urn:ietf:wg:oauth:2.0:oob`; authentication will fail otherwise.

---

## Step 2: Authenticate Zoro with Simkl

1. Open **Zoro plugin settings** in Obsidian.  
2. Click **Enter Client ID**, paste your **Client ID**, and confirm.  
3. Click **Enter Client Secret**, paste your **Client Secret**, and confirm.  
4. Click **Authenticate**.  
5. You’ll be redirected to Simkl—log in (if needed) and **authorize** the app.  
6. After a few seconds, you’ll return to Simkl’s site.  
7. Go back to Obsidian—you’ll see an **Authenticated** notification when successful.  

---

That’s it! Your Simkl account is now securely connected to **Zoro**.