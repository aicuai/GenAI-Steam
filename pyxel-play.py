import pyxel
 
pyxel.init(100, 100)
 
m1 = "t90 @1 o2 q8 l16 x0:7654 x1:743 x0d4x1f8d8e8fgx0f8.x1e x0d4defgx1a8ga>c8dc< f8b-8x0a2>c+efg x1a8gfe8fg fed8f8ed <b8>c+dc+dec+defab-8a8 g8f8x0g4.<x1g8f8e8 x0q7d2"
m2 = "t90 @1 o1 q8 l8 x0:532 x0 f4afgaa4 f4b-4a4>g4< b-4>e4d4g4 b-d<b->c<a>daf g+de<a>a>cfe dc<bgedc+<g q7f2"
m3 = "t90 @0 o1 q8 l8 v6 d2c4<b-4& b-4g4f4>e4 d4c+4<b-4a4 g4>c4<f4b4 e4agfed>c< b-ag4&gb-a4> q7d2"
 
pyxel.sounds[0].mml(m1)
pyxel.sounds[1].mml(m2)
pyxel.sounds[2].mml(m3)
pyxel.musics[0].set([0], [1], [2])
pyxel.playm(0, loop=True)
 
pyxel.show()
