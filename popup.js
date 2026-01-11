// ============================================
// DATEI: popup.js
// Amazon Bestellungen Scraper - v3 (pro Artikel)
// ============================================

let scrapedData = [];
let isScrapingAll = false;

// Klick-Handler
document.getElementById('scrapeBtn').addEventListener('click', async () => {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const counter = document.getElementById('counter');

  if (isScrapingAll) {
    showStatus('Scraping läuft bereits...', 'info');
    return;
  }

  scrapeBtn.disabled = true;
  scrapeBtn.textContent = 'Scraping läuft...';
  isScrapingAll = true;
  scrapedData = [];
  counter.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('amazon.de')) {
      showStatus('Fehler: Bitte öffne zuerst die Amazon Bestellübersicht.', 'error');
      resetButton();
      return;
    }

    const timeFilter = document.getElementById('timeFilter').value;
    showStatus(`Scrape alle Übersichtsseiten (${timeFilter})...`, 'info');

    // Phase 1: Übersichtsseiten scrapen
    let pageIndex = 0;
    let hasMorePages = true;
    let consecutiveEmptyPages = 0;
    let allOrders = [];

    while (hasMorePages && pageIndex < 20) {
      const baseUrl = 'https://www.amazon.de/your-orders/orders';
      const amazonFilter = getAmazonTimeFilter(timeFilter);
      const url = pageIndex === 0
        ? `${baseUrl}?timeFilter=${amazonFilter}`
        : `${baseUrl}?startIndex=${pageIndex * 10}&timeFilter=${amazonFilter}`;

      showStatus(`Scrape Übersichtsseite ${pageIndex + 1}...`, 'info');

      await chrome.tabs.update(tab.id, { url });
      await delay(2000);

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeOverviewPage
      });

      const newOrders = result[0]?.result || [];
      const filteredOrders = filterByDate(newOrders, timeFilter);

      if (filteredOrders && filteredOrders.length > 0) {
        consecutiveEmptyPages = 0;
        filteredOrders.forEach(order => {
          if (!allOrders.some(o => o.bestellnummer === order.bestellnummer)) {
            allOrders.push(order);
          }
        });
        counter.textContent = `${allOrders.length} Bestellungen`;
        showStatus(
          `Übersicht ${pageIndex + 1}: ${filteredOrders.length} gefiltert (Gesamt: ${allOrders.length})`,
          'success'
        );
        pageIndex++;
      } else {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 2) {
          hasMorePages = false;
        } else {
          pageIndex++;
        }
      }
    }

    // Phase 2: Bestelldetails scrapen (pro Artikel eine Zeile)
    if (allOrders.length > 0) {
      showStatus(`Scrape jetzt ${allOrders.length} Bestelldetails...`, 'info');

      for (let i = 0; i < allOrders.length; i++) {
        const order = allOrders[i];
        if (!order.details_url) continue;

        showStatus(`Details ${i + 1}/${allOrders.length}: ${order.bestellnummer}`, 'info');

        await chrome.tabs.update(tab.id, { url: order.details_url });
        await delay(2000);

        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeDetailsPage
        });

        const details = result[0]?.result;
        if (details && Array.isArray(details.artikel) && details.artikel.length > 0) {
          details.artikel.forEach(artikel => {
            const detailedOrder = {
              bestellnummer: order.bestellnummer || '',
              datum: order.datum || '',
              artikel: artikel.name || '',
              preis: artikel.preis || '',
              verkauft_von: artikel.verkauft_von || '',
              status: cleanText(artikel.status || order.status || ''),
              gesamtsumme: cleanText(details.gesamtsumme || ''),
              versandadresse: cleanText(details.versandadresse || ''),
              zahlungsart: cleanText(details.zahlungsart || ''),
              details_url: order.details_url || ''
            };
            scrapedData.push(detailedOrder);
          });
        } else {
          // Fallback: nur Übersichtsdaten
          scrapedData.push({
            bestellnummer: order.bestellnummer || '',
            datum: order.datum || '',
            artikel: order.artikel || '',
            preis: order.preis || '',
            verkauft_von: '',
            status: cleanText(order.status || ''),
            gesamtsumme: '',
            versandadresse: '',
            zahlungsart: '',
            details_url: order.details_url || ''
          });
        }
      }
    } else {
      showStatus('Keine Bestellungen im gewählten Zeitraum gefunden.', 'info');
    }

    // Gesamtsumme nur einmal pro Bestellung setzen
    scrapedData = normalizeTotalsPerOrder(scrapedData);

    showStatus(`Fertig! ${scrapedData.length} Artikel gefunden`, 'success');
    if (scrapedData.length > 0) {
      document.getElementById('downloadCsvBtn').disabled = false;
    }
  } catch (error) {
    console.error(error);
    showStatus('Fehler: ' + error.message, 'error');
  } finally {
    resetButton();
  }
});

document.getElementById('downloadCsvBtn').addEventListener('click', () => {
  downloadCSV(scrapedData);
  showStatus('CSV wird heruntergeladen...', 'success');
});

// ============================================
// Hilfsfunktionen (Popup-Kontext)
// ============================================

function resetButton() {
  const scrapeBtn = document.getElementById('scrapeBtn');
  scrapeBtn.disabled = false;
  scrapeBtn.textContent = 'Alle Seiten scrapen (mit Details)';
  isScrapingAll = false;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = type;
  status.style.display = 'block';
}

// Text aufräumen (Zeilenumbrüche / NBSP)
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/\u00A0/g, ' ')   // non‑breaking space
    .replace(/\s+/g, ' ')      // alle Whitespaces zu einem Space
    .trim();
}

// Mapping Zeitfilter -> Amazon timeFilter
function getAmazonTimeFilter(timeFilter) {
  switch (timeFilter) {
    case 'current-month':
      return 'month-0';      // aktueller Monat
    case 'last-month':
      return 'month-1';      // letzter Monat
    case 'months-3':
      return 'months-3';     // letzte 3 Monate
    case 'year-2025':
      return 'year-2025';
    default:
      return 'month-0';
  }
}

// Datum lokal filtern
function filterByDate(orders, timeFilter) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return orders.filter(order => {
    if (!order.datum) return false;

    const dateMatch = order.datum.match(/(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})/);
    if (!dateMatch) return false;

    const day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2];
    const year = parseInt(dateMatch[3], 10);

    const monthMap = {
      'Januar': 0, 'Februar': 1, 'März': 2, 'April': 3, 'Mai': 4, 'Juni': 5,
      'Juli': 6, 'August': 7, 'September': 8, 'Oktober': 9, 'November': 10, 'Dezember': 11
    };

    const month = monthMap[monthName];
    const orderDate = new Date(year, month, day);

    switch (timeFilter) {
      case 'current-month':
        return year === currentYear && month === currentMonth;
      case 'last-month': {
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        return year === lastMonthYear && month === lastMonth;
      }
      case 'months-3': {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        return orderDate >= threeMonthsAgo;
      }
      case 'year-2025':
        return year === 2025;
      default:
        return true;
    }
  });
}

// Gesamtsumme nur bei erster Zeile je Bestellung, danach leeren
function normalizeTotalsPerOrder(items) {
  const seenOrder = new Set();
  return items.map(row => {
    const key = row.bestellnummer || row.details_url;
    if (!key) return row;

    if (seenOrder.has(key)) {
      return {
        ...row,
        gesamtsumme: ''
      };
    } else {
      seenOrder.add(key);
      return row;
    }
  });
}

// CSV-Export
function downloadCSV(data) {
  const cleaned = (data || []).filter(row =>
    row &&
    row.bestellnummer &&
    row.datum
  );

  const headers = [
    'Bestellnummer',
    'Datum',
    'Artikel',
    'Preis',
    'Verkauft_von',
    'Status',
    'Gesamtsumme',
    'Versandadresse',
    'Zahlungsart',
    'Details_URL'
  ];

  const rows = cleaned.map(item => [
    item.bestellnummer || '',
    item.datum || '',
    cleanText(item.artikel || '').replace(/"/g, '""'),
    cleanText(item.preis || '').replace(/"/g, '""'),
    cleanText(item.verkauft_von || '').replace(/"/g, '""'),
    cleanText(item.status || '').replace(/"/g, '""'),
    cleanText(item.gesamtsumme || '').replace(/"/g, '""'),
    cleanText(item.versandadresse || '').replace(/"/g, '""'),
    cleanText(item.zahlungsart || '').replace(/"/g, '""'),
    cleanText(item.details_url || '').replace(/"/g, '""')
  ]);

  const csvContent = [
    headers.join(';'),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
  ].join('\n');

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const timeFilter = document.getElementById('timeFilter').value;
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `amazon_bestellungen_${timeFilter}_${timestamp}.csv`;

  chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });
}

// ============================================
// SCRAPING-FUNKTIONEN (Tab-Kontext)
// ============================================

function scrapeOverviewPage() {
  const orders = [];
  console.log('=== START OVERVIEW SCRAPING ===');
  console.log('URL:', window.location.href);

  // STRATEGIE 1: Order Cards (neue Struktur)
  const orderCards = document.querySelectorAll('.order-card, .order, div[class*="order-"]');
  console.log('Strategie 1 - Order Cards gefunden:', orderCards.length);

  if (orderCards.length > 0) {
    orderCards.forEach((card, index) => {
      const order = {};

      const orderIdElement = card.querySelector('.yohtmlc-order-id span, .order-info span, span.a-color-secondary');
      if (orderIdElement) {
        const text = orderIdElement.textContent;
        const match = text.match(/(\d{3}-\d{7}-\d{7})/);
        if (match) {
          order.bestellnummer = match[1];
        }
      }
      if (!order.bestellnummer) {
        const allText = card.textContent;
        const match = allText.match(/(\d{3}-\d{7}-\d{7})/);
        if (match) {
          order.bestellnummer = match[1];
        }
      }
      if (!order.bestellnummer) return;

      console.log(`Card ${index + 1}: ${order.bestellnummer}`);

      const dateMatch = card.textContent.match(/(\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*\d{4})/);
      if (dateMatch) {
        order.datum = dateMatch[1];
      }

      const articleLink = card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      if (articleLink) {
        let artikelName = articleLink.textContent.trim();
        if (!artikelName || artikelName.length < 3) {
          artikelName = articleLink.getAttribute('title') || '';
        }
        if (!artikelName || artikelName.length < 3) {
          const img = articleLink.querySelector('img') || card.querySelector('img');
          if (img) {
            artikelName = img.getAttribute('alt') || '';
          }
        }
        order.artikel = (artikelName || '').trim();
      }

      const priceMatch = card.textContent.match(/(\d+[,\.]\d+\s*€)/);
      if (priceMatch) {
        order.preis = priceMatch[0];
      }

      const statusElem = card.querySelector('.delivery-box__primary-text, .shipment-top-row span, span[class*="delivery"]');
      if (statusElem) {
        order.status = statusElem.textContent.trim();
      }

      const detailsLink = card.querySelector('a[href*="order-details"]');
      if (detailsLink) {
        order.details_url = detailsLink.href.split('&ref=')[0];
      }

      orders.push(order);
    });
  }

  // STRATEGIE 2: Fallback
  if (orders.length === 0) {
    console.log('Strategie 2 - Suche nach span.a-color-secondary.value');
    const nummerElemente = document.querySelectorAll('span.a-color-secondary.value, span.a-color-secondary');
    nummerElemente.forEach(numSpan => {
      const text = numSpan.textContent.trim();
      const match = text.match(/(\d{3}-\d{7}-\d{7})/);
      if (!match) return;
      const nummer = match[1];
      const order = { bestellnummer: nummer };

      let row = numSpan.closest('tr') ||
                numSpan.closest('div.a-box-group') ||
                numSpan.closest('div[class*="order"]');

      if (!row) {
        row = numSpan.parentElement;
        for (let i = 0; i < 20 && row; i++) {
          const hasLink = row.querySelector('a[href*="/dp/"]');
          if (hasLink) break;
          row = row.parentElement;
        }
      }
      if (!row) return;

      const allText = row.textContent;
      const dateMatch = allText.match(/(\d{1,2}\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*\d{4})/);
      if (dateMatch) order.datum = dateMatch[0];

      const articleLink = row.querySelector('a[href*="/dp/"]');
      if (articleLink) {
        let artikelName = articleLink.textContent.trim();
        if (!artikelName || artikelName.length < 3) {
          artikelName = articleLink.getAttribute('title') || '';
        }
        if (!artikelName || artikelName.length < 3) {
          const img = articleLink.querySelector('img') || row.querySelector('img');
          if (img) {
            artikelName = img.getAttribute('alt') || '';
          }
        }
        order.artikel = (artikelName || '').trim();
      }

      const priceMatch = allText.match(/(\d+[,\.]\d+\s*€)/);
      if (priceMatch) order.preis = priceMatch[0];

      const statusElem = row.querySelector('.delivery-box__primary-text, span[class*="delivery"]');
      if (statusElem) order.status = statusElem.textContent.trim();

      const detailsLink = row.querySelector('a[href*="order-details"]');
      if (detailsLink) {
        order.details_url = detailsLink.href.split('&ref=')[0];
      }

      orders.push(order);
    });
  }

  // STRATEGIE 3: Brute Force
  if (orders.length === 0) {
    console.log('Strategie 3 - Brute Force im gesamten Dokument');
    const bodyText = document.body.textContent;
    const matches = bodyText.match(/\d{3}-\d{7}-\d{7}/g);
    if (matches) {
      const uniqueNumbers = [...new Set(matches)];
      uniqueNumbers.forEach(nummer => {
        const xpath = `//*[contains(text(), '${nummer}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const element = result.singleNodeValue;
        if (!element) return;

        const order = { bestellnummer: nummer };
        let container = element;
        for (let i = 0; i < 15 && container.parentElement; i++) {
          container = container.parentElement;
          if (container.querySelector('a[href*="/dp/"]')) break;
          if (container.textContent.length > 200) break;
        }

        const allText = container.textContent;
        const dateMatch = allText.match(/(\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*\d{4})/);
        if (dateMatch) order.datum = dateMatch[1];

        const articleLink = container.querySelector('a[href*="/dp/"]');
        if (articleLink) {
          let artikelName = articleLink.textContent.trim();
          if (!artikelName || artikelName.length < 3) {
            artikelName = articleLink.getAttribute('title') || '';
          }
          if (!artikelName || artikelName.length < 3) {
            const img = articleLink.querySelector('img') || container.querySelector('img');
            if (img) artikelName = img.getAttribute('alt') || '';
          }
          order.artikel = (artikelName || '').trim();
        }

        const priceMatch = allText.match(/(\d+[,\.]\d+\s*€)/);
        if (priceMatch) order.preis = priceMatch[0];

        const statusElem = container.querySelector('.delivery-box__primary-text, span.a-text-bold, span[class*="delivery"]');
        if (statusElem) order.status = statusElem.textContent.trim();

        const detailsLink = container.querySelector('a[href*="order-details"]');
        if (detailsLink) order.details_url = detailsLink.href.split('&ref=')[0];

        orders.push(order);
      });
    }
  }

  console.log('=== OVERVIEW SCRAPING FERTIG ===', orders.length);
  return orders;
}

function scrapeDetailsPage() {
  const details = {
    artikel: [],
    gesamtsumme: '',
    versandadresse: '',
    zahlungsart: ''
  };

  console.log('=== Starte Detail-Scraping ===');

  const shipments = document.querySelectorAll('div[data-component="shipments"] div.a-box-inner');
  if (shipments.length > 0) {
    shipments.forEach(shipment => {
      let shipmentStatus = '';
      const statusRow = shipment.querySelector('#shipment-top-row');
      if (statusRow) {
        shipmentStatus = statusRow.textContent.trim();
      }

      const itemTitleDivs = shipment.querySelectorAll('div[data-component="itemTitle"]');
      itemTitleDivs.forEach(titleDiv => {
        const productLink = titleDiv.querySelector('a[href*="/dp/"]');
        if (!productLink) return;

        const artikel = {
          name: productLink.textContent.trim(),
          url: productLink.href,
          preis: '',
          verkauft_von: '',
          status: shipmentStatus
        };

        let container = titleDiv.closest('div.a-fixed-left-grid') || titleDiv.closest('div.a-row');

        if (container) {
          const priceElement = container.querySelector('div[data-component="unitPrice"] span[aria-hidden="true"], span.a-price span[aria-hidden="true"]');
          if (priceElement) artikel.preis = priceElement.textContent.trim();

          const merchantDiv = container.querySelector('div[data-component="orderedMerchant"]');
          if (merchantDiv) {
            const sellerLink = merchantDiv.querySelector('a');
            if (sellerLink) {
              artikel.verkauft_von = sellerLink.textContent.trim();
            } else {
              const sellerMatch = merchantDiv.textContent.match(/Verkauf durch:\s*(.+)/);
              if (sellerMatch) {
                artikel.verkauft_von = sellerMatch[1].trim();
              }
            }
          }
        }

        details.artikel.push(artikel);
      });
    });
  } else {
    const itemTitleDivs = document.querySelectorAll('div[data-component="itemTitle"]');
    itemTitleDivs.forEach(titleDiv => {
      const productLink = titleDiv.querySelector('a[href*="/dp/"]');
      if (!productLink) return;

      const artikel = {
        name: productLink.textContent.trim(),
        url: productLink.href,
        preis: '',
        verkauft_von: '',
        status: ''
      };

      let container = titleDiv.closest('div.a-fixed-left-grid') || titleDiv.closest('div.a-row');

      if (container) {
        const priceElement = container.querySelector('div[data-component="unitPrice"] span[aria-hidden="true"], span.a-price span[aria-hidden="true"]');
        if (priceElement) artikel.preis = priceElement.textContent.trim();

        const merchantDiv = container.querySelector('div[data-component="orderedMerchant"]');
        if (merchantDiv) {
          const sellerLink = merchantDiv.querySelector('a');
          if (sellerLink) {
            artikel.verkauft_von = sellerLink.textContent.trim();
          } else {
            const sellerMatch = merchantDiv.textContent.match(/Verkauf durch:\s*(.+)/);
            if (sellerMatch) {
              artikel.verkauft_von = sellerMatch[1].trim();
            }
          }
        }
      }

      details.artikel.push(artikel);
    });
  }

  // Gesamtsumme
  const summaryList = document.querySelector('div[data-component="chargeSummary"] ul.a-unordered-list');
  if (summaryList) {
    const lineItems = summaryList.querySelectorAll('li');
    lineItems.forEach(item => {
      const labelElement = item.querySelector('.od-line-item-row-label');
      const valueElement = item.querySelector('.od-line-item-row-content');
      if (!labelElement || !valueElement) return;
      const label = labelElement.textContent.trim().toLowerCase();
      if (label.includes('gesamtsumme')) {
        const boldValue = valueElement.querySelector('span.a-text-bold');
        if (boldValue) {
          details.gesamtsumme = boldValue.textContent.trim();
        }
      }
    });
  }

  // Versandadresse
  const shippingDiv = document.querySelector('div[data-component="shippingAddress"]');
  if (shippingDiv) {
    const addressList = shippingDiv.querySelector('ul');
    if (addressList) {
      const addressParts = [];
      const items = addressList.querySelectorAll('li span.a-list-item');
      items.forEach(item => {
        let text = item.innerHTML
          .replace(/<br\s*\/?>/gi, ', ')
          .replace(/<[^>]+>/g, '')
          .trim();
        if (text && text.length > 2) addressParts.push(text);
      });
      details.versandadresse = addressParts.join(' | ');
    }
  }

  // Zahlungsart inkl. Gutschein + Kontonummer
  try {
    const nextDataScript = document.querySelector('script#__NEXT_DATA__');
    if (nextDataScript && nextDataScript.textContent) {
      const json = JSON.parse(nextDataScript.textContent);
      const list =
        json?.props?.pageProps?.applicationData
          ?.getSelectedPaymentMethodsResponse?.displayResponse
          ?.paymentMethodInstrumentDisplayList?.paymentMethodInstrumentDisplayDatumList || [];

      const methods = list.map(entry => {
        const core = entry.paymentMethodDisplayDatumCore || {};
        const header = core.paymentMethodHeader || '';
        const num = core.paymentMethodNumber || {};
        const prefix = num.prefix || '';
        const lastDigits = num.lastDigits || '';
        const numberPart = (prefix || lastDigits)
          ? `${prefix}${lastDigits}`
          : '';
        return numberPart ? `${header} ${numberPart}`.trim() : header.trim();
      }).filter(Boolean);

      if (methods.length === 1) {
        details.zahlungsart = methods[0];
      } else if (methods.length > 1) {
        const gutscheine = methods.filter(m => m.toLowerCase().includes('gutschein'));
        const andere = methods.filter(m => !m.toLowerCase().includes('gutschein'));
        details.zahlungsart = [...gutscheine, ...andere].join(' + ');
      }
    }

    if (!details.zahlungsart) {
      const paymentWidget = document.querySelector('div[data-component="viewPaymentPlanSummaryWidget"]');
      if (paymentWidget) {
        const methodNames = paymentWidget.querySelectorAll('[data-testid="method-details-name"]');
        const methods = Array.from(methodNames)
          .map(el => el.textContent.trim())
          .filter(t => t.length > 0);

        if (methods.length === 1) {
          details.zahlungsart = methods[0];
        } else if (methods.length > 1) {
          const gutscheine = methods.filter(m => m.toLowerCase().includes('gutschein'));
          const andere = methods.filter(m => !m.toLowerCase().includes('gutschein'));
          details.zahlungsart = [...gutscheine, ...andere].join(' + ');
        }
      }
    }

    details.zahlungsart = cleanText(details.zahlungsart || '');
  } catch (e) {
    console.warn('Fehler beim Lesen der Zahlungsart', e);
  }

  console.log('=== Scraping abgeschlossen ===');
  console.log('Gefundene Artikel:', details.artikel.length);
  return details;
}
