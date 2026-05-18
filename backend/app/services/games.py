GAME_ROTATION = ["tower_defense"]
BATCH_SIZE = 10


def game_for_batch(batch_index: int) -> str:
    return GAME_ROTATION[batch_index % len(GAME_ROTATION)]
