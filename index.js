const hyperdrive = require('hyperdrive')
const Networking = require('corestore-swarm-networking')
const Peersockets = require('peersockets')

const drive = hyperdrive('./drive')
let links = new Set()
let data = []

drive.readFile('links.json', 'utf-8', function (err, str) {
  if (str) {
    links = new Set(JSON.parse(str).map(l => l.link))
    data = JSON.parse(str).map((d, i) => {
      return {
        title: d.title,
        link: d.link,
        id: d.id || i,
        votes: d.votes || 0,
        submitted: d.submitted || new Date(0)
      }
    })
  }
})

const html = `<html><head><meta charset="utf-8"><title>User submitted drives (USD)</title></head><body>
  <h1>Welcome to the user submitted drives (USD) peer service</h1>
  <ul id="frontpage">
  </ul>
  <form class="online">
    <input id="title" placeholder="What is this site about ...">
    <input id="key" placeholder="hyper://...">
    <input type="submit" id="submit" value="Submit link">
  </form>
  <details>
    <summary>Click here to help moderate USD by upvoting interesting links (<span id="new-count">0</span> links)</summary>
    <ul id="newest">
    </ul>
  </details>
  <style>
    li {
      margin-top: 10px;
    }
    ul {
      margin: 20px 0;
    }

    summary {
      cursor: pointer;
    }
  </style>
  <script>
    const d = beaker.hyperdrive.drive()

    d.watch('/links.json', updateLinks)

    updateLinks()

    function updateLinks () {
      beaker.hyperdrive.readFile('/links.json').then(function (l) {
        const links = JSON.parse(l)
        const ul = document.querySelector('#frontpage')
        const nul = document.querySelector('#newest')

        ul.innerHTML = ''
        nul.innerHTML = ''

        const fp = links.filter(l => l.votes).sort(function (a, b) {
          const av = a.votes || 0
          const bv = b.votes || 0
          return bv - av
        })

        const newest = links.filter(l => !l.votes).sort(function (a, b) {
          return new Date(b.submitted).getTime() - new Date(a.submitted).getTime()
        })

        for (const link of fp) {
          addLink(link, ul)
        }

        for (const link of newest) {
          addLink(link, nul)
        }

        document.querySelector('#new-count').innerText = newest.length
      })

      function addLink (link, ul) {
        const id = link.id
        const li = document.createElement('li')
        const a = document.createElement('a')
        const div = document.createElement('div')
        div.innerText = link.title
        a.href = link.link
        a.innerText = link.link
        const votes = document.createElement('div')
        const btn = document.createElement('button')
        btn.className = 'online'
        const span = document.createElement('span')
        span.innerText = '' + (link.votes || 0) + ' votes'
        btn.innerText = 'upvote'
        votes.appendChild(span)
        votes.appendChild(btn)

        li.appendChild(div)
        li.appendChild(votes)
        li.appendChild(a)
        ul.appendChild(li)

        btn.onclick = function () {
          send({ type: 'vote', id, link: link.link })
        }
      }
    }

    const t = document.querySelector('#title')
    const k = document.querySelector('#key')
    const f = document.querySelector('form')
    let keyToAdd

    f.onsubmit = function (e) {
      e.preventDefault()

      const key = k.value.trim().replace('hyper://', '')

      if (!/^[a-f0-9]{64}(\\/)?.*$/.test(key)) {
        return
      }

      send({ type: 'link', title: t.value.trim(), link: 'hyper://' + key })
    }

    const messages = []
    const peerIds = new Set()
    const peerEvents = beaker.peersockets.watch()
    let topic = null

    function send (m) {
      m = new TextEncoder('utf-8').encode(JSON.stringify(m))
      messages.push(m)

      if (!topic) {
        topic = beaker.peersockets.join('awesome-drives')

        topic.addEventListener('message', e => {
          console.log('peer', e.peerId, 'says', new TextDecoder().decode(e.message))
          messages.shift()
          if (!messages.length) {
            topic.close()
            topic = null
          }
        })
      }

      for (const peerId of peerIds) {
        for (const m of messages) {
          console.log('sending 2', peerId, m)
          topic.send(peerId, m)
        }
      }
    }

    peerEvents.addEventListener('join', e => {
      peerIds.add(e.peerId)
      if (messages.length && topic) {
        for (const m of messages) {
          console.log('sending 2', e.peerId, m)
          topic.send(e.peerId, m)
        }
      }
    })

    peerEvents.addEventListener('leave', e => {
      peerIds.delete(e.peerId)
    })
  </script>
</body></html>`

drive.readFile('index.html', 'utf-8', function (err, st) {
  if (st === html) return
  drive.writeFile('index.html', html)
})

drive.ready(function () {
  console.log('hyper://' + drive.key.toString('hex'))
  console.log('discoveryKey: ' + drive.discoveryKey.toString('hex'))

  const n = new Networking(drive.corestore)

  const sockets = new Peersockets(n)

  n.join(drive.discoveryKey, {
    announce: true
  })

  const handle = sockets.join(massageTopic('awesome-drives', drive.discoveryKey), {
    onmessage (remoteKey, msg) {
      const m = JSON.parse(msg)
      console.log('recv', m)
      if (m.type === 'vote') {
        drive.readFile('/votes/' + remoteKey.toString('hex') + '/' + m.id, function (err) {
          if (!err) return handle.send(remoteKey, 'ack')
          drive.writeFile('/votes/' + remoteKey.toString('hex') + '/' + m.id, m.link || '', function () {
            data[m.id].votes++
            console.log(data[m.id])
            drive.writeFile('links.json', JSON.stringify(data), function () {
              handle.send(remoteKey, 'ack')
            })
          })
        })
        return
      }

      if (links.has(m.link)) return
      m.id = data.length
      m.submitted = new Date()
      m.votes = 0
      drive.writeFile('/votes/' + remoteKey.toString('hex') + '/' + m.id, m.link, function () {
        links.add(m.link)
        data.push(m)
        drive.writeFile('links.json', JSON.stringify(data), function () {
          handle.send(remoteKey, 'ack')
        })
      })
    }
  })
})


function massageTopic (topic, discoveryKey) {
  return `webapp/${discoveryKey.toString('hex')}/${topic}`
}
