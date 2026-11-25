/** Medidas de una hoja A4 en milímetros y el margen que se deja alrededor */
const A4 = { width: 210, height: 297, margin: 10 };

/**
 * Descarga un elemento de la página como PDF A4 (por ejemplo, la hoja de un comprobante).
 * El navegador lo dibuja tal como se ve —mismo diseño, QR y sellos— y lo pone en el PDF;
 * no pasa por el servidor. Si es más alto que una hoja, sigue en las siguientes.
 * Las librerías se cargan recién al usarla.
 */
export async function downloadPdf(element: HTMLElement, fileName: string): Promise<void> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const image = await toJpeg(element, {
    quality: 0.92,
    pixelRatio: 2.5,
    backgroundColor: '#ffffff',
    // Tamaño exacto de la hoja: sin esto se cuelan sus márgenes de centrado y la corren
    width: element.offsetWidth,
    height: element.offsetHeight,
    style: { margin: '0', transform: 'none', boxShadow: 'none' },
    // Lo marcado como no imprimible tampoco va al PDF
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains('no-print')),
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const width = A4.width - A4.margin * 2;
  const height = (element.offsetHeight * width) / element.offsetWidth;
  const pageHeight = A4.height - A4.margin * 2;
  // Cada hoja muestra el siguiente tramo de la imagen
  for (let offset = 0; offset < height; offset += pageHeight) {
    if (offset > 0) pdf.addPage();
    pdf.addImage(image, 'JPEG', A4.margin, A4.margin - offset, width, height);
    // Tapa lo que se sale del margen inferior y superior de esta hoja
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, A4.width, A4.margin, 'F');
    pdf.rect(0, A4.height - A4.margin, A4.width, A4.margin, 'F');
  }
  pdf.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
