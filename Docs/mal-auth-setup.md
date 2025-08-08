# 🔐 MyAnimeList (MAL) Authentication Guide for Zoro Plugin

To log in, you’ll need to create your own **Client ID** and **Client Secret** from MyAnimeList (MAL). It’s quick and easy—just follow these steps.

---

## 📌 Step-by-Step Instructions

1. **Go to the MAL API Page**
   👉 [https://myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)

2. **Click "Create App"**.

3. **Fill in the form with these details:**

   | Field            | Value                                                              |
   | ---------------- | ------------------------------------------------------------------ |
   | **App Name**     | `Zoro`                                                             |
   | **App Type**     | `Web`                                                              |
   | **Redirect URI** | `http://localhost:8080/callback` (Make sure to copy this exactly!) |
   | **Description**  | `Obsidian plugin for managing anime and manga lists`               |
   | **Company Name** | `Zoro`                                                             |

   > ⚠️ **Important**: Ensure the **Redirect URI** is exactly `http://localhost:8080/callback` to make the authentication work.

4. **Click Save** to create your app.

---

### 🎥 Watch the Video Guide

If you're not sure how to follow the steps, here's a quick video guide:

[![Watch the YouTube Short](https://img.youtube.com/vi/dg-vHw4mM6M/0.jpg)](https://youtu.be/dg-vHw4mM6M)

---

## 🔐 How to Authenticate with MAL

1. **Create an app on MAL** and copy your:

   * **Client ID**
   * **Client Secret**

2. **Open the Zoro plugin settings** in Obsidian.

3. **Click the "Enter Client ID"** button.
   → Paste your **Client ID** and confirm.

4. The button will now change to **"Enter Client Secret"**.
   → Paste your **Client Secret** and confirm.

5. The button will now say **"Authenticate"**.
   → Click it.

6. You will be redirected to **MAL**.
   → Log in (if needed) and **authorize** the app.

7. **MAL will show you a URL** that looks like `http://localhost:8080/callback?code=ABC123`.
   → **Copy the entire URL**.

8. Go back to **Obsidian**.
   → Paste the full URL into the plugin’s prompt.

9. Wait a moment.
   → You’ll see a ✅ **"Authenticated"** notification once the connection is successful.

---

✅ That’s it! Your **MAL** account is now securely connected to **Zoro**.

---
