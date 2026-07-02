from django.urls import path
from . import views

urlpatterns = [
    path('generate', views.generate_captcha, name='generate_captcha'),
    path('validate', views.validate_captcha, name='validate_captcha'),
    path('health', views.health_check, name='health_check'),
]
