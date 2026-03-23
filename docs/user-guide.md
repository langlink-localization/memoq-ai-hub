# memoQ AI Hub User Guide

[English](user-guide.md) | [简体中文](user-guide.zh-CN.md)

This guide is for translators and project users who want to start using memoQ AI Hub from scratch.

## System Overview

memoQ AI Hub has two cooperating parts:

- **Desktop app (memoQ AI Hub)**: configures AI providers, manages terminology assets, builds translation profiles, and exposes the local HTTP gateway at `http://127.0.0.1:5271` by default.
- **memoQ plugin DLL**: lives in memoQ's `Addins` directory and forwards translation requests from memoQ to the local gateway.

Request flow:

`memoQ -> plugin DLL -> local gateway (5271) -> AI provider -> translation -> memoQ`

## Step 1: Install the Plugin DLL

### 1.1 Install from the Desktop App

1. Open the memoQ AI Hub desktop app.
2. Go to **Dashboard**.
3. Click **Install / Reinstall**.
4. Choose one of these install modes:
   - **Use default memoQ path**: pick memoQ `10 / 11 / 12` and let the app resolve the install directory.
   - **Choose custom directory**: browse to a non-standard memoQ installation folder.
5. Confirm the destination and click **Install plugin**.
6. If an older DLL or `ClientDevConfig.xml` already exists, confirm the overwrite prompt.
7. After completion, the dashboard should show a successful integration message.

The installer writes these files into memoQ's `Addins` directory:

- `MemoQ.AI.Hub.Plugin.dll`
- `ClientDevConfig.xml`, which enables unsigned plugins through `<LoadUnsignedPlugins>true</LoadUnsignedPlugins>`

### 1.2 Manual Install

1. Download the latest release package from GitHub Releases.
2. Extract it and locate:
   - `MemoQ.AI.Hub.Plugin.dll`
   - `ClientDevConfig.xml`
3. Copy them into memoQ's `Addins` directory, for example:

```text
C:\Program Files\memoQ\memoQ-11\Addins\
```

4. Overwrite `ClientDevConfig.xml` if it already exists.

## Step 2: Configure an AI Provider

1. Open **Provider Center** in the left navigation.
2. Click **+ New** and choose a provider type:
   - **OpenAI Official**
   - **OpenAI Compatible**
3. Fill in:
   - **Name**
   - **API Key**
   - **Base URL**, for example `https://api.openai.com/v1`
   - **Request Path**, only when the compatible endpoint does not use the default path
4. Click **Test** and wait until the connection status turns green.
5. Click **Save**.

### 2.1 Add Models

1. Click **Add model** in the model area.
2. Click **Discover models** to fetch supported models from the provider.
3. Click **Add** for the models you want to use.
4. Set one model as the **default model**.
5. Save the provider again after confirming the model is enabled.

## Step 3: Upload a Terminology Asset

If you do not need terminology support yet, you can skip this step.

1. Open **Assets**.
2. Click **+ New** -> **Upload terminology asset**.
3. Choose a local terminology file. TBX and common spreadsheet formats are supported.
4. After upload, click **Preview** to inspect the parsed result.
5. If the parser confidence is low, manually assign the source column, target column, and language pair, then save the mapping.

## Step 4: Build a Translation Profile in Builder

1. Open **Builder**.
2. Click **+ New** to create a profile.
3. Fill in the profile name and optional description.
4. Complete the four configuration steps.

### 4.1 Providers and Models

Choose providers and models for these routes:

- **Interactive route**: used for live translation inside memoQ
- **Batch route**: used for pre-translation and other bulk operations
- **Fallback route**: used when the primary route fails

### 4.2 Style and Prompt Strategy

- Choose a preset style such as natural, formal, technical, marketing, or UI copy
- Or enter a custom instruction, for example:

```text
Use concise UI copy, natural target-language phrasing, and keep product terminology consistent.
```

The remaining role instructions, formatting protection, and JSON structure are assembled by the system automatically.

### 4.3 Bind a Terminology Asset

- Select the uploaded TB asset from the **TB** dropdown
- Leave it empty if terminology is not needed

### 4.4 Advanced Options

Optional capabilities include:

- Use memoQ best fuzzy TM match
- Use memoQ metadata
- Enable adaptive cache
- Use preview context

5. Click **Save Profile**.
6. Click **Set as default** if this should be the default profile.

## Step 5: Keep the Desktop App Running

Make sure the memoQ AI Hub desktop app stays open while memoQ is using it, because the local gateway must keep listening on port `5271`.

## Step 6: Configure the Plugin in memoQ

### 6.1 Create an MT Resource

1. In memoQ, open **Resource Console**.
2. Find **MT Settings** and click **Create new**.
3. Choose **My Computer** and create the resource.
4. In the MT engine list, enable **memoQ AI Hub** and open its settings.

### 6.2 Plugin Settings

The default values are normally correct:

- **Gateway Base URL**: `http://127.0.0.1:5271`
- **Enable Gateway**: enabled
- **Formatting Mode**: `BothFormattingAndTags`

Optional changes:

- Change **Gateway Base URL** if the desktop gateway uses a different port
- Set **Default Profile ID** if a memoQ project should use a specific profile instead of the desktop default

### 6.3 Enable Related Features

In memoQ MT settings, point these features to **memoQ AI Hub**:

- **Pre-translation**
- **Match and Patch**
- **Send best fuzzy TM match**
- **Self-learning MT**

### 6.4 Enable the MT Resource in a Project

1. Open the project and go to **Project -> Settings -> MT settings**
2. Enable the **memoQ AI Hub** resource you created
3. Save the project settings

## Step 7: Translate or Run Pre-translation

### Interactive Translation

1. Open a document in the memoQ editor and select a source segment.
2. Choose **memoQ AI Hub** in the MT results panel.
3. memoQ sends the request to the desktop app and shows the returned translation.
4. After you confirm the translation, the desktop app can store it through `StoreTranslation` for future cache hits.

### Pre-translation

1. Right-click a document in the project manager and choose **Pre-translate**
2. Select **memoQ AI Hub** as the MT engine
3. Run the job and let the batch route translate the segments

### History and Runtime Status

- Open **History** in the desktop app to inspect source text, target text, latency, and success data
- Use **Dashboard** to monitor gateway status, memoQ connectivity, and recent notifications

## FAQ

**The dashboard says disconnected. What should I check?**

1. Confirm the desktop app is running
2. Confirm **Enable Gateway** is still checked in plugin settings
3. Confirm `Gateway Base URL` is still `http://127.0.0.1:5271`
4. Click **Test connection** on the dashboard

**Why is the Save button disabled in Provider Center?**

- You must run **Test** first and wait for a successful green connection state

**Why was my terminology file not recognized correctly?**

- Open **Preview** in Assets
- If the confidence is low, manually assign source column, target column, and language pair, then save the mapping

**How do I use different profiles for different projects?**

- Fill in **Default Profile ID** in the memoQ plugin settings
- Leave it blank to use the desktop app default profile

**How do I upgrade the DLL later?**

- Run **Install / Reinstall** again from the dashboard
- Or manually replace the DLL in the `Addins` directory and restart memoQ
