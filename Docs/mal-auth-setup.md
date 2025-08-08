# 🔐 MyAnimeList (MAL) Authentication Guide for Zoro Plugin

---

### 📌 **What You Need:**

1. **A MyAnimeList (MAL) account** - If you don’t have one, sign up [here](https://myanimelist.net/).
2. **Client ID and Client Secret from MAL** - You’ll get these when creating a MAL app.
3. **A couple of minutes of your time** - The steps are quick and easy!

---

### 🚀 **Step-by-Step Guide**

#### 1️⃣ **Create Your MAL App**

* Go to the [MAL API](https://myanimelist.net/apiconfig) (this is where you get your keys).
* Click on **"Create App"**.

  * This will open a form where you need to enter some details.

---

#### 2️⃣ **Fill in the Form**

You just need to fill out three fields. Here’s what to put in:

| Field            | Value                                               |
| ---------------- | --------------------------------------------------- |
| **App Name**     | `Zoro` (This is the name of your plugin)            |
| **App Type**     | `Web`                                               |
| **Redirect URI** | `http://localhost:8080/callback` (Copy it exactly!) |
| **Description**  | `Obsidian plugin for managing anime and manga lists`    |
| **Company Name** | `Zoro`                                              |
> ⚠️ **Important:** Make sure the **Redirect URI** is exactly: `http://localhost:8080/callback`. This is super important for the plugin to work correctly!

---

#### 3️⃣ **Get Your Keys**

* Once you save the app, you'll see your **Client ID** and **Client Secret**.

  * **Client ID**: This starts with `mal_client_...`.
  * **Client Secret**: Keep this safe! It’s private.

---

### 🔐 **Linking MAL with Zoro**

#### 4️⃣ **Plugin Setup in Obsidian**

1. Open **Obsidian** and go to **Settings** → **Zoro**.
2. **Enter Client ID**: Click "Enter MAL Client ID" and paste your Client ID there.
3. **Enter Client Secret**: Click "Enter MAL Client Secret" and paste your Client Secret.
4. Click on **"Authenticate"** – this will open the MAL login page.

---

#### 5️⃣ **Authorize Zoro in MAL**

1. **MAL Login**: Sign in with your MAL account.
2. **Permission Screen**: When prompted, click **"Allow"**.
3. **Redirect Page**: After that, you’ll be redirected to a URL that looks like `http://localhost:8080/callback?code=ABC123`.

* **Copy** the entire URL.

---

#### 6️⃣ **Final Step**

* Paste the **full URL** you copied into the plugin’s prompt in Obsidian.
* That’s it! **Done**. ✅

---

### ✅ **Success Checklist**

* Your **Client ID** and **Client Secret** should be saved in the plugin.
* A **Sign Out** button will appear in the settings.
* Your **MAL username** should show in the plugin’s stats.
* You can now **edit your MAL entries** directly in Obsidian without issues!

---

### 🎉 **You're All Set!**

You can now:

* **Track anime and manga** from MAL inside Obsidian.
* **Edit your progress** directly within Obsidian.
* **Sync updates** between Zoro and MAL seamlessly!

---
