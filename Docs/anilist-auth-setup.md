# 🔐 AniList API Setup Guide for Zoro Plugin

To login , you'll need to create your own **Client ID** and **Client Secret** from AniList. It's quick and easy—just follow these simple steps.

---

## 📌 Step-by-Step Instructions

1. **Go to the AniList Developer Page**  
   👉 [https://anilist.co/settings/developer](https://anilist.co/settings/developer)

2. **Click “Create New App”** at the top.

3. **Fill in only these two fields:**

   - **App Name**:  
     ```
     Zoro
     ```

   - **Redirect URI**:  
     ```
     https://anilist.co/api/v2/oauth/pin
     ```

4. Click **Save**.

---

## ✅ Done!

After saving, you'll see:
- **ID** → This is your **Client ID**
- **Secret** → This is your **Client Secret**
- 
Paste these into the Zoro Optional login settings inside Obsidian and hit **Authenticate**.

That’s it! 🎉 
