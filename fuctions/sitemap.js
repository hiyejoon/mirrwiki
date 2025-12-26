global.XMLHttpRequest = require('xhr2');
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");

const firebaseConfig = { /* 위와 동일하게 입력 */ };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

exports.handler = async () => {
    try {
        const snap = await getDocs(collection(db, 'artifacts', 'mirrwiki-default', 'public', 'data', 'wiki_pages'));
        let xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        xml += `<url><loc>https://mirrwiki.netlify.app/</loc><priority>1.0</priority></url>`;
        snap.forEach(d => {
            const lastMod = d.data().updatedAt?.toDate().toISOString().split('T')[0] || new Date().toISOString().split('T')[0];
            xml += `<url><loc>https://mirrwiki.netlify.app/w/${encodeURIComponent(d.id)}</loc><lastmod>${lastMod}</lastmod></url>`;
        });
        xml += '</urlset>';

        return { statusCode: 200, headers: { 'Content-Type': 'application/xml' }, body: xml };
    } catch (e) {
        return { statusCode: 500, body: e.toString() };
    }
};