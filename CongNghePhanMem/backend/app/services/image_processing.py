from io import BytesIO
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError


def normalize(data, max_pixels=16_000_000):
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in {'JPEG','PNG','WEBP'}:
                raise HTTPException(415,'Choose a JPEG, PNG or WebP image')
            if source.width*source.height>max_pixels:
                raise HTTPException(413,'Image exceeds 16 megapixels')
            source.load()
            image=ImageOps.exif_transpose(source).convert('RGB')
            image.thumbnail((2400,2400))
            result=BytesIO();image.save(result,'JPEG',quality=88)
            if len(result.getvalue())>5*1024*1024:
                raise HTTPException(413,'Normalized image exceeds 5 MB; choose a smaller image')
            return result.getvalue()
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError):
        raise HTTPException(415,'The file is not a valid image') from None


def thumbnail(data):
    with Image.open(BytesIO(data)) as image:
        width,height=image.size
        image.thumbnail((480,360))
        result=BytesIO();image.save(result,'JPEG',quality=78,optimize=True)
        return result.getvalue(),width,height
