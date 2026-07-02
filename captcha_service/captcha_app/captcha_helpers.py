import random

def uppercase_alphanumeric_challenge():
    # Exclude ambiguous characters (like 0, O, I, 1) for clean, readable text
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    word = "".join(random.choice(chars) for _ in range(6))
    return word, word
