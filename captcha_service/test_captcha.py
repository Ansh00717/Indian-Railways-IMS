import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'captcha_project.settings')
django.setup()

from captcha.models import CaptchaStore
from captcha.helpers import captcha_image_url

new_key = CaptchaStore.generate_key()
url = captcha_image_url(new_key)
print(new_key)
print(url)
