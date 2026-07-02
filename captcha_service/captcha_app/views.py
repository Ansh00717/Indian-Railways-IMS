import json
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from captcha.models import CaptchaStore
from captcha.helpers import captcha_image_url

logger = logging.getLogger(__name__)

@csrf_exempt
def generate_captcha(request):
    if request.method == 'GET':
        new_key = CaptchaStore.generate_key()
        image_url = captcha_image_url(new_key)
        
        # Ensure absolute URL is http://127.0.0.1:8000
        absolute_image_url = f"http://127.0.0.1:8000{image_url}"
        
        print(f"[CAPTCHA GENERATE] Generated new key: {new_key}", flush=True)
        print(f"[CAPTCHA GENERATE] Image URL: {absolute_image_url}", flush=True)
        logger.info(f"Generated captcha key: {new_key}, url: {absolute_image_url}")
        
        return JsonResponse({
            "captcha_key": new_key,
            "captcha_image": absolute_image_url
        })
    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def validate_captcha(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            key = data.get('captcha_key')
            value = data.get('captcha_value')
            
            print(f"[CAPTCHA VALIDATE] Validating key: {key} with user input: {value}", flush=True)
            logger.info(f"Validating captcha key: {key} with value: {value}")
            
            if not key or not value:
                print("[CAPTCHA VALIDATE] Missing key or value", flush=True)
                return JsonResponse({"success": False, "error": "Missing key or value"})
                
            try:
                CaptchaStore.objects.get(
                    response=value.lower(), 
                    hashkey=key, 
                    expiration__gt=timezone.now()
                ).delete()
                print("[CAPTCHA VALIDATE] Validation SUCCESS", flush=True)
                return JsonResponse({"success": True})
            except CaptchaStore.DoesNotExist:
                print("[CAPTCHA VALIDATE] Validation FAILED - Invalid or expired", flush=True)
                return JsonResponse({"success": False, "message": "Invalid captcha"})
        except json.JSONDecodeError:
            print("[CAPTCHA VALIDATE] Invalid JSON payload", flush=True)
            return JsonResponse({"success": False, "error": "Invalid JSON"})
    return JsonResponse({"error": "Method not allowed"}, status=405)

def health_check(request):
    return JsonResponse({"status": "ok"})
