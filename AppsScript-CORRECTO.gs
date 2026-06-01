var PEDIDOS_EMAIL = "contacto@gmexpress.com";
var SHEET_ID = "1HD4rA_WoEoA-BbunlTrzDdtNkKaN5ygFzY5s4ZL3Be0";

/* =========================
   UTIL
========================= */

function doGet() {
  return ContentService.createTextOutput("OK - WebApp activa");
}

function parsePostJson_(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

/* =========================
   MAIN ENTRY
========================= */

function doPost(e) {
  var out = { ok: false, error: "" };

  try {
    var data = parsePostJson_(e);

    if (!data) {
      out.error = "JSON inválido o vacío";
      return jsonOut_(out);
    }

    var items = data.items;

    if (!items || items.length === 0) {
      out.error = "Sin productos";
      return jsonOut_(out);
    }

    // IMPORTANTE: SIEMPRE abrir por ID (NO active spreadsheet)
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];

    var values = sheet.getDataRange().getValues();

    if (values.length < 2) {
      out.error = "Hoja vacía";
      return jsonOut_(out);
    }

    var headers = values[0].map(function(h) { return String(h || "").trim(); });

    var skuCol = findCol_(headers, ["SKU", "sku"]);
    var stockCol = findCol_(headers, ["Stock", "STOCK", "stock"]);
    var productoCol = findCol_(headers, ["Producto", "producto"]);

    if (stockCol < 0) {
      out.error = "No existe columna Stock";
      return jsonOut_(out);
    }

    var updates = [];

    for (var i = 0; i < items.length; i++) {
      var it = items[i];

      var sku = String(it.sku || "").trim();
      var nombre = String(it.nombre || "").trim();
      var cantidad = parseInt(it.cantidad || 0, 10);

      if (cantidad <= 0) continue;

      var rowIndex = -1;
      var currentStock = 0;

      // Buscar por SKU primero
      if (sku && skuCol >= 0) {
        for (var r = 1; r < values.length; r++) {
          if (String(values[r][skuCol]).trim() === sku) {
            rowIndex = r;
            currentStock = parseInt(values[r][stockCol]) || 0;
            break;
          }
        }
      }

      // fallback por nombre
      if (rowIndex === -1 && productoCol >= 0) {
        for (var r2 = 1; r2 < values.length; r2++) {
          if (
            String(values[r2][productoCol]).trim().toLowerCase() ===
            nombre.toLowerCase()
          ) {
            rowIndex = r2;
            currentStock = parseInt(values[r2][stockCol]) || 0;
            break;
          }
        }
      }

      if (rowIndex === -1) {
        out.error = "Producto no encontrado: " + nombre;
        return jsonOut_(out);
      }

      if (currentStock < cantidad) {
        out.error =
          "Stock insuficiente en: " + nombre +
          " (hay " + currentStock + ", piden " + cantidad + ")";
        return jsonOut_(out);
      }

      updates.push({
        row: rowIndex + 1,
        col: stockCol + 1,
        value: currentStock - cantidad,
        nombreProducto: nombre
      });
    }

    // APLICAR UPDATES
    if (updates.length > 0) {
      for (var u = 0; u < updates.length; u++) {
        sheet.getRange(updates[u].row, updates[u].col).setValue(updates[u].value);
      }
      
      // FLUSH para asegurar que guarda
      SpreadsheetApp.flush();
    }

    // Enviar email
    MailApp.sendEmail({
      to: PEDIDOS_EMAIL,
      replyTo: data.contact || "noreply@example.com",
      subject: "Nuevo pedido - " + (data.name || "Sin nombre"),
      body: buildEmail_(data, updates)
    });

    out.ok = true;
    return jsonOut_(out);

  } catch (err) {
    out.error = "ERROR: " + (err.message || String(err));
    return jsonOut_(out);
  }
}

/* =========================
   HELPERS
========================= */

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function findCol_(headers, names) {
  for (var i = 0; i < headers.length; i++) {
    for (var j = 0; j < names.length; j++) {
      if (headers[i] === names[j]) return i;
    }
  }
  return -1;
}

function buildEmail_(data, updates) {
  var txt = "Nuevo pedido\n\n";
  txt += "Nombre: " + (data.name || "") + "\n";
  txt += "Contacto: " + (data.contact || "") + "\n";
  txt += "Dirección: " + (data.deliveryAddress || "No especificada") + "\n\n";

  txt += "Productos:\n";

  for (var i = 0; i < (data.items || []).length; i++) {
    var it = data.items[i];
    txt += "- " + it.nombre + " x" + it.cantidad + "\n";
  }

  txt += "\n--- Stock actualizado en Sheets ---\n";
  if (updates && updates.length > 0) {
    for (var j = 0; j < updates.length; j++) {
      txt += "- " + updates[j].nombreProducto + ": " + updates[j].value + " unidades\n";
    }
  }

  return txt;
}
