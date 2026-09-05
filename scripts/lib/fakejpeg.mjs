// A JPEG with real EXIF (time, offset, GPS, camera) for tests, made in-process.
import sharp from "sharp";
import piexif from "piexifjs";

// piexifjs predates EXIF 2.31; teach it OffsetTimeOriginal so we can write it.
piexif.TAGS.Exif[36881] = { name: "OffsetTimeOriginal", type: "Ascii" };

export async function fakeJpeg({ date, offset, lat, lng, w = 2000, h = 1500, seed = 0 } = {}) {
  const raw = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40 + seed * 20, g: 60, b: 120 } } }).jpeg({ quality: 70 }).toBuffer();
  const exif = { "0th": { [piexif.ImageIFD.Make]: "TestCam", [piexif.ImageIFD.Model]: `T${seed}` }, Exif: {}, GPS: {} };
  if (date) exif.Exif[piexif.ExifIFD.DateTimeOriginal] = date;
  if (offset) exif.Exif[36881] = offset;
  if (lat !== undefined) {
    exif.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S"; exif.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat));
    exif.GPS[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? "E" : "W"; exif.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lng));
  }
  return Buffer.from(piexif.insert(piexif.dump(exif), raw.toString("binary")), "binary");
}
