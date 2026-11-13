# WhatsApp Sender · Rotaract Club of Rubaga

A small web app for sending personalised WhatsApp messages (and an optional flyer) to a contact list, one click per contact.

**Privacy:** the app is static HTML/JS. Contact lists, messages and flyers are processed in the browser and are never uploaded. A loaded list is kept in the browser's local storage on that device only, and can be removed with "Remove list from this device". Don't commit contact lists to this repository.

## How to use
1. Download the blank template from the app and fill in First Name and Phone Number (Extra Info is optional).
2. Load the Excel file. The message and country code are read from the template's Settings tab and can be edited in the app.
3. Optionally add a flyer image.
4. Send:
   - **Text only:** "Send" opens WhatsApp with the message typed in.
   - **Flyer on a computer:** "Copy flyer & open chat", then paste with Ctrl+V (Cmd+V) in the chat. The message becomes the caption.
   - **Flyer on a phone:** "Share with flyer", choose WhatsApp, then the contact.

## Files
- `index.html`, `style.css`, `app.js`: the app
- `vendor/xlsx.full.min.js`: SheetJS 0.18.5 (Apache-2.0), bundled so no external CDN is needed
- `template/WhatsApp_Contacts_Template.xlsx`: blank contact template
