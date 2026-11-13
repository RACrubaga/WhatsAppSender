# WhatsApp Sender · Rotaract Club of Rubaga

A small web app for sending personalised WhatsApp messages (and an optional flyer) to a contact list, one click per contact.

**Privacy:** the app is static HTML/JS. Contact lists, messages and flyers are processed in the browser and are never uploaded. A loaded list is kept in the browser's local storage on that device only, and can be removed with "Remove list from this device". Don't commit contact lists to this repository.

## Features
- **Upload:** drag and drop an Excel (.xlsx/.xls) or CSV file. Name and phone columns are detected automatically and can be changed. Numbers starting with 0 get the default country code.
- **Compose:** one message with placeholder chips built from your columns ({Name}, {First Name}, plus any other column), WhatsApp formatting (bold, italic, strikethrough), quick emoji and a warning for unknown placeholders.
- **Live preview:** a WhatsApp-style phone preview you can page through contact by contact.
- **Flyer:** add an image; each contact gets a separate **Copy flyer** button (computers) or **Share** (phones).
- **Send:** a **Send message** button per contact, plus **Send to next pending**. Invalid and duplicate numbers are flagged and blocked.
- **Statistics:** totals, ready/sent/pending/issues, progress ring, sending activity chart, pace and time left, and a CSV report export.

## Files
- `index.html`, `style.css`, `app.js`: the app (font: Google Sans; icons: Material Symbols, both from Google Fonts)
- `vendor/xlsx.full.min.js`: SheetJS 0.18.5 (Apache-2.0), bundled so no external CDN is needed
- `template/WhatsApp_Contacts_Template.xlsx`: blank contact template
