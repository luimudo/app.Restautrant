const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 1400;

const toDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo preparar la imagen.'));
    reader.readAsDataURL(blob);
});

const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Resizes without cropping, so the full product photo remains visible. */
export const optimizeProductImage = async (file) => {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('Selecciona una imagen JPG, PNG o WebP.');
    }
    if (file.size > MAX_SOURCE_BYTES) throw new Error('La imagen original debe pesar menos de 12 MB.');

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error('No se pudo leer la imagen seleccionada.');
    }

    try {
        const scale = Math.min(1, MAX_EDGE / bitmap.width, MAX_EDGE / bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('El navegador no pudo procesar la imagen.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        let blob = await canvasBlob(canvas, 'image/webp', 0.88);
        if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg', 0.9);
        for (const quality of [0.82, 0.74, 0.66]) {
            if (blob && blob.size <= MAX_OUTPUT_BYTES) break;
            blob = await canvasBlob(canvas, blob?.type || 'image/webp', quality);
        }
        if (!blob || blob.size > MAX_OUTPUT_BYTES) throw new Error('No se pudo reducir la imagen a 3 MB manteniendo su calidad.');
        return await toDataUrl(blob);
    } finally {
        bitmap.close?.();
    }
};
