const express = require('express')
const app = express()
const port = 80
app.use(function (req, res, next) {
  console.log('%s %s %s',req.headers.host, req.method, req.url)
  next()
})
app.all('*', (req, res) => res.send('Hello World!'))

app.listen(port, () => console.log(`Example app listening on port ${port}!`))